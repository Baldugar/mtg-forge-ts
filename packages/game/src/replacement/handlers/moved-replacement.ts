// SPDX-License-Identifier: GPL-3.0-or-later
// MovedReplacement — handles Forge's `R:Event$ Moved` replacement line.
// Intercepts moveTo mutation intents and redirects the destination zone,
// or prevents the move entirely (Prevent$ True).
//
// Forge pattern:
//   R:Event$ Moved | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | ReplaceWith$ DBExile
//   | Description$ If this would die, exile it instead.
//
// Supported ReplaceWith$ conventions (Part F Wave 1):
//   DBExile  — redirect destination to Exile
//   DBHand   — redirect destination to Hand
//   DBLibrary — redirect destination to Library
//
// Prevent$ True  — return null (event prevented entirely; the card doesn't move).
//
// Wave 67 — ReplaceWith$ <SVar> dispatch into the ReplaceEffect family. When
// the SVar resolves to `DB$ ReplaceEffect` (the generic VarName/VarValue
// rewrite), the parent threads the moveTo intent through the side-channel
// runner so the rewritten destination flows back into the apply loop. This
// covers Rest in Peace ("if a card would be put into a graveyard from
// anywhere, exile it instead") expressed as
// `R:Event$ Moved | ReplaceWith$ DBExile` AND the more general SVar-bodied
// shape used for conditional / SVar-targeted redirects.
import type {
  EntityId,
  MutationIntent,
  ReplacementAbility,
  ReplacementAst,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility, runReplaceWithIntentMutation } from "./replace-with-svar.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a literal string param from ReplacementAst.params, or return undefined. */
const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/** Map a ReplaceWith$ key to the target ZoneType string value, or null if unknown. */
const replaceWithToZone = (key: string): ZoneType | null => {
  switch (key) {
    case "DBExile":
      return "Exile" as ZoneType;
    case "DBHand":
      return "Hand" as ZoneType;
    case "DBLibrary":
      return "Library" as ZoneType;
    case "DBGraveyard":
      return "Graveyard" as ZoneType;
    case "DBBattlefield":
      return "Battlefield" as ZoneType;
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// MovedReplacement
// ---------------------------------------------------------------------------

export class MovedReplacement extends ReplacementHandler {
  static override readonly eventKind = "Moved";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const originParam = getParamRaw(ast, "Origin") ?? "Any";
    const destParam = getParamRaw(ast, "Destination") ?? "Any";
    const validParam = getParamRaw(ast, "ValidCard") ?? "Card";
    const prevent = getParamRaw(ast, "Prevent") === "True";
    const replaceWith = ast.effect.handlerKey;
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "moveTo") return false;
        const mi = intent as { toZone?: ZoneType; cardId?: EntityId; fromZone?: ZoneType };

        // Origin$ param: "Any" matches all, otherwise must match fromZone
        if (originParam !== "Any" && mi.fromZone !== (originParam as ZoneType)) return false;

        // Destination$ param: "Any" matches all, otherwise must match toZone
        if (destParam !== "Any" && mi.toZone !== (destParam as ZoneType)) return false;

        // ValidCard$ filter
        if (validParam === "Card.Self") return mi.cardId === sourceCardId;
        if (validParam === "Card") return true;

        // Other ValidCard$ filters deferred to Part F2
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        // Prevent$ True — stop the move entirely
        if (prevent) return null;

        // ReplaceWith$ destination redirect (canonical DBExile / DBHand / etc.)
        const targetZone = replaceWithToZone(replaceWith);
        if (targetZone !== null) {
          return { ...intent, toZone: targetZone };
        }

        // Wave 67 — ReplaceWith$ <SVar> dispatch into the ReplaceEffect family.
        // When the SVar resolves to a generic intent-mutating handler
        // (DB$ ReplaceEffect — VarName$ toZone | VarValue$ Exile etc.), thread
        // the in-flight moveTo intent through the side-channel runner so the
        // rewritten destination flows back into the apply loop.
        const game = gameUnknown as Game;
        const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWith);
        if (ability !== null) {
          const handlerKey = ability.handlerKey;
          if (handlerKey === "ReplaceEffect") {
            const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, intent);
            return next;
          }
        }

        // Unknown replaceWith → return unchanged (no-op redirect)
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(MovedReplacement);

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
// More complex replacements (DBCreateToken, DBReturnWithCounter, etc.) require
// full SVar-ability dispatch and are deferred to Part F2.
import type {
  EntityId,
  MutationIntent,
  ReplacementAbility,
  ReplacementAst,
  ZoneType,
} from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

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

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        // Prevent$ True — stop the move entirely
        if (prevent) return null;

        // ReplaceWith$ destination redirect
        const targetZone = replaceWithToZone(replaceWith);
        if (targetZone !== null) {
          return { ...intent, toZone: targetZone };
        }

        // Unknown replaceWith → return unchanged (no-op redirect)
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(MovedReplacement);

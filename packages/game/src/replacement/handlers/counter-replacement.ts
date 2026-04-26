// SPDX-License-Identifier: GPL-3.0-or-later
// CounterReplacement — handles Forge's `R:Event$ Counter` replacement line.
// Intercepts counter-spell mutation intents and either prevents the counter
// (Cavern of Souls / Gaea's Herald — `Layer$ CantHappen` / `Prevent$ True`)
// or redirects the destination zone via `ReplaceWith$ <SVar>`.
//
// Forge patterns:
//   R:Event$ Counter | ValidCard$ Card.Self | Layer$ CantHappen
//     | Description$ This spell can't be countered.
//   R:Event$ Counter | ValidCard$ Card.Self+wasCastUsingMana<W>
//     | Layer$ CantHappen
//   R:Event$ Counter | ValidCard$ Creature | ReplaceWith$ DBExile
//     | Description$ Countered creatures are exiled instead.
//
// Wave 48 supports:
//   ValidCard$ Card.Self                       — match self only.
//   ValidCard$ Card / Permanent / Any          — match any countered card.
//   ValidCard$ <Type>.YouCtrl / .OppCtrl       — type+control filter.
//   Layer$ CantHappen / Prevent$ True          — block the counter.
//   ReplaceWith$ DBExile / DBHand / DBLibrary  — redirect destination.
//   ReplaceWith$ <SVar>                        — synchronous SVar dispatch.
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility, runReplaceWithAbilitySync } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/** Map a ReplaceWith$ key to the target ZoneType string value, or null. */
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
    default:
      return null;
  }
};

/**
 * Lightweight ValidCard$ matcher tailored to Counter replacement.
 * Operates on the countered card's identity (the spell's source card).
 * Recognises Card.Self, Card / Permanent / Any, and `<Type>.YouCtrl` /
 * `.OppCtrl` filters via the card's primary types and controller seat.
 */
const matchesValidCardLite = (
  filter: string,
  cardId: EntityId,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
  game: Game | undefined,
): boolean => {
  if (filter === "Card.Self") return cardId === sourceCardId;
  if (filter === "Card" || filter === "Permanent" || filter === "Any") return true;
  const dotIndex = filter.indexOf(".");
  if (dotIndex < 0) return false;
  const typeKey = filter.slice(0, dotIndex);
  const qualifier = filter.slice(dotIndex + 1);
  const card = game?.cards.get(cardId);
  if (!card) return false;
  const types = card.paperCard?.definition?.types as { has?: (t: string) => boolean } | undefined;
  if (types?.has === undefined) return false;
  if (!types.has(typeKey)) return false;
  const cardCtrl = card.controllerSeat;
  if (qualifier === "YouCtrl") return cardCtrl === controllerSeat;
  if (qualifier === "OppCtrl") return cardCtrl !== controllerSeat;
  return false;
};

// ---------------------------------------------------------------------------
// CounterReplacement
// ---------------------------------------------------------------------------

export class CounterReplacement extends ReplacementHandler {
  static override readonly eventKind = "Counter";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId, game } = ctx;
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith") ?? ast.effect.handlerKey;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      // Counter-prevention abilities live on the battlefield (Gaea's Herald)
      // or on the stack itself (Cavern of Souls — naming a creature type at
      // cast resolves into a static counter-protection rider that's active
      // while the spell is on the stack). We accept both.
      activeInZones: new Set(["Battlefield" as never, "Stack" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "countered") return false;
        const ci = intent as { counteredCardId?: EntityId };
        if (ci.counteredCardId === undefined) return false;
        return matchesValidCardLite(validCardRaw, ci.counteredCardId, sourceCardId, controllerSeat, game);
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ DBExile/DBHand/DBLibrary — redirect destination.
        const targetZone = replaceWithToZone(replaceWithKey);
        if (targetZone !== null) {
          return { ...(intent as object), destination: targetZone } as unknown as MutationIntent;
        }
        // ReplaceWith$ <SVar> — synchronous SVar dispatch (mirrors
        // destroy-replacement / moved-replacement Wave 17b path).
        if (replaceWithKey !== undefined && replaceWithKey !== ast.effect.handlerKey) {
          const g = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(g, sourceCardId, replaceWithKey);
          if (ability !== null) {
            runReplaceWithAbilitySync(g, sourceCardId, controllerSeat, ability);
            return null;
          }
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(CounterReplacement);

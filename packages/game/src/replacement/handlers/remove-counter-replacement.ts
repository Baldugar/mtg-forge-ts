// SPDX-License-Identifier: GPL-3.0-or-later
// RemoveCounterReplacement — handles Forge's `R:Event$ RemoveCounter`
// replacement line. Intercepts removeCounter mutation intents and either
// prevents the removal entirely (Layer$ CantHappen) or modifies the
// amount removed (Result$ LT1 → leave at least one counter; deferred SVar
// dispatch beyond MVP).
//
// Forge patterns:
//   R:Event$ RemoveCounter | ActiveZones$ Battlefield | ValidCard$ Permanent.OppCtrl
//     | ValidCounterType$ STUN | Layer$ CantHappen
//     | Description$ Stun counters can't be removed from permanents your opponents control.
//   R:Event$ RemoveCounter | ActiveZones$ Battlefield | IsPresent$ Creature.YouCtrl
//     | ValidCard$ Planeswalker.YouCtrl+ChosenType | Result$ LT1 | ValidCounterType$ LOYALTY
//     | IsDamage$ True | ReplaceWith$ ReduceLoss | Description$ ...
//
// MVP support:
//   ValidCard$ Card.Self           — match when intent.cardId === sourceCardId.
//   ValidCard$ Card                — any card.
//   ValidCard$ Permanent.OppCtrl   — match when the target card's controller
//                                    differs from the replacement's controller.
//   ValidCard$ Permanent.YouCtrl   — match when controllers match.
//   ValidCounterType$ <NAME>       — match when intent.counterType matches
//                                    (case-insensitive lookup against
//                                    CounterType enum values).
//   Layer$ CantHappen / Prevent$ True — apply() returns null (full prevention).
//
// Other ValidCard$ filters (planeswalker subtype, ChosenType, IsPresent$
// gates) and Result$/ReplaceWith$ partial-prevention deferred to SP4.
import type { EntityId, MutationIntent, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class RemoveCounterReplacement extends ReplacementHandler {
  static override readonly eventKind = "RemoveCounter";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card";
    const validCounterTypeRaw = getParamRaw(ast, "ValidCounterType");
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const { sourceCardId, controllerSeat, replacementId, game } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "removeCounter") return false;
        const mi = intent as { cardId?: EntityId; counterType?: string };
        if (mi.cardId === undefined) return false;

        // ValidCard$ filter
        if (validCardRaw === "Card.Self") {
          if (mi.cardId !== sourceCardId) return false;
        } else if (validCardRaw === "Permanent.OppCtrl") {
          const targetCard = game.cards.get(mi.cardId);
          if (!targetCard) return false;
          if (targetCard.controllerSeat === controllerSeat) return false;
        } else if (validCardRaw === "Permanent.YouCtrl") {
          const targetCard = game.cards.get(mi.cardId);
          if (!targetCard) return false;
          if (targetCard.controllerSeat !== controllerSeat) return false;
        } else if (validCardRaw !== "Card") {
          // Other filters deferred to SP4.
          return false;
        }

        // ValidCounterType$ filter (case-insensitive). Forge encodes counter
        // types as enum-like keys (P1P1, M1M1, LOYALTY, STUN, etc.); our
        // engine stores them as string-typed CounterType values that may
        // differ in casing. Compare case-insensitively to be robust.
        if (validCounterTypeRaw !== undefined && mi.counterType !== undefined) {
          if (validCounterTypeRaw.toLowerCase() !== mi.counterType.toLowerCase()) {
            return false;
          }
        }

        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // Other replacement modes (Result$ LT1 partial prevention,
        // ReplaceWith$ <SVar> redirection) deferred to SP4.
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(RemoveCounterReplacement);

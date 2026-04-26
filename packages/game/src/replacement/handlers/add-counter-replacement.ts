// SPDX-License-Identifier: GPL-3.0-or-later
// AddCounterReplacement — handles Forge's `R:Event$ AddCounter` replacement.
// Intercepts counter-addition mutation intents and multiplies (or otherwise
// modifies) the amount. Doubling Season / Vorinclex / Hardened Scales
// belong here.
//
// Forge patterns:
//   R:Event$ AddCounter | ValidCard$ Permanent.YouCtrl | Amount$ 2
//     | Description$ If one or more counters would be put on a permanent
//                    you control, twice that many of each kind are put on
//                    it instead. (Doubling Season counter half)
//   R:Event$ AddCounter | ValidCard$ Creature.YouCtrl
//                       | CounterType$ P1P1 | Amount$ 1
//     | Description$ Hardened Scales — if one or more +1/+1 counters
//                    would be put on a creature you control, that many
//                    plus one are put on it instead.
//
// Wave 48 supports:
//   ValidCard$ Card.Self / Card / Permanent / Any            — wildcard match.
//   ValidCard$ <Type>.YouCtrl / .OppCtrl                     — type+control filter.
//   CounterType$ <NAME>                                       — restrict to one
//                                                              counter type
//                                                              (Hardened Scales).
//   Amount$ <int>                                             — multiplier.
//   AddAmount$ <int>                                          — additive bump
//                                                              (Hardened Scales
//                                                              "+1 more").
//   Layer$ CantHappen / Prevent$ True                         — block addition.
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

const parseLiteralInt = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

/** Lightweight ValidCard$ matcher (mirrors counter-replacement's). */
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
// AddCounterReplacement
// ---------------------------------------------------------------------------

export class AddCounterReplacement extends ReplacementHandler {
  static override readonly eventKind = "AddCounter";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId, game } = ctx;
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Permanent.YouCtrl";
    const counterTypeRaw = getParamRaw(ast, "CounterType");
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const multiplier = parseLiteralInt(getParamRaw(ast, "Amount"));
    const addAmount = parseLiteralInt(getParamRaw(ast, "AddAmount"));

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
        if (intent.kind !== "addCounter") return false;
        const ci = intent as { cardId?: EntityId; counterType?: string };
        if (ci.cardId === undefined) return false;
        if (
          counterTypeRaw !== undefined &&
          ci.counterType !== undefined &&
          String(ci.counterType) !== counterTypeRaw
        ) {
          return false;
        }
        return matchesValidCardLite(validCardRaw, ci.cardId, sourceCardId, controllerSeat, game);
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        const ci = intent as { amount?: number };
        const current = ci.amount ?? 1;
        let newAmount = current;
        if (multiplier !== null && multiplier > 1) newAmount = current * multiplier;
        if (addAmount !== null && addAmount !== 0) newAmount = newAmount + addAmount;
        if (newAmount === current) return intent;
        return { ...intent, amount: newAmount };
      },
    };
  }
}

replacementHandlerRegistry.register(AddCounterReplacement);

// SPDX-License-Identifier: GPL-3.0-or-later
// PumpAllEffect — board-wide +N/+M UEOT pump on all cards matching a
// ValidCards$ filter. Like PumpEffect, but applies to ALL matching permanents
// rather than sa.targets.
//
// Forge DSL:
//   A:SP$ PumpAll | Cost$ 2 W | ValidCards$ Creature.YouCtrl
//     | NumAtt$ 1 | NumDef$ 1 | Duration$ untilEndOfTurn
//     | SpellDescription$ Creatures you control get +1/+1 until end of turn.
//
// Supported ValidCards$ filter tokens (MVP):
//   Creature           — any card with CardType.Creature in its types
//   Creature.YouCtrl   — Creature + controlled by sa.controllerSeat
//   Creature.OpponentCtrl — Creature + NOT controlled by sa.controllerSeat
//
// Per-card effects: one Layer7c ContinuousEffect per matching card (same
// pattern as PumpEffect). Each carries the same timestamp so stacking with
// other simultaneous pumps is dependency-safe.
import { CardType, type ContinuousEffect, Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Parse ValidCards$ filter tokens and return matching card ids. */
const filterMatchingCards = (
  sa: SpellAbility,
  game: Game,
): readonly import("@mtg-forge-ts/core").EntityId[] => {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Creature";
  // Tokens are dot-separated: "Creature", "Creature.YouCtrl", etc.
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "creature";
  const qualifier = tokens[1] ?? "";

  const matchingIds: import("@mtg-forge-ts/core").EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Type check via LayerEngine (accounts for animate effects, etc.).
    const chars = game.layerEngine.computeCharacteristics(id);

    // Base type filter.
    if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;

    // Controller qualifier.
    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;

    matchingIds.push(id);
  }
  return matchingIds;
};

export class PumpAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PumpAll";

  // biome-ignore lint/correctness/useYield: ContinuousEffectRegistry.register is synchronous — no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const powerDelta = evaluateParamNumber(sa, "NumAtt", game);
    const toughnessDelta = evaluateParamNumber(sa, "NumDef", game);

    const matchingIds = filterMatchingCards(sa, game);

    for (const _targetId of matchingIds) {
      const timestamp: number = game.newEntityId();
      const layer7c: Layer7cEffect = {
        kind: "modify",
        powerDelta,
        toughnessDelta,
        timestamp,
        sourceAbilityId: sa.sourceCardId,
      };
      const effect: ContinuousEffect = {
        id: game.newEntityId(),
        sourceCardId: sa.sourceCardId,
        timestamp,
        layer: Layer.L7c_PTModify,
        duration: { kind: "untilEndOfTurn" },
        payload: { kind: "pt-modify", effect: layer7c },
      };
      game.continuousEffectRegistry.register(effect);
    }
  }
}

effectRegistry.register(PumpAllEffect);

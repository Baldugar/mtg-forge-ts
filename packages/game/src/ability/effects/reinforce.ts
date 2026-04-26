// SPDX-License-Identifier: GPL-3.0-or-later
// ReinforceEffect — resolver for the synthesized Reinforce activated
// ability (Morningtide, CR 702.76). After CostDiscard moves the source
// to the graveyard, this effect picks any battlefield Creature via a
// chooseCard decision and stamps N +1/+1 counters on it.
import type { EntityId } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ReinforceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Reinforce";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amountRaw = evaluateParamRaw(sa, "Amount");
    const parsed = Number.parseInt(amountRaw, 10);
    const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    const eligible: EntityId[] = [];
    for (const [id, c] of game.cards) {
      if (c.zone !== ZoneType.Battlefield) continue;
      const chars = game.layerEngine.computeCharacteristics(id);
      if (!chars.types.has(CardType.Creature)) continue;
      eligible.push(id);
    }
    if (eligible.length === 0) return;

    const decision = (yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: sa.controllerSeat,
        pool: eligible,
        restriction: { keyword: "reinforce", n },
        min: 1,
        max: 1,
      },
    }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

    const targetId = decision?.kind === "chooseCard" ? decision.chosen[0] : undefined;
    if (targetId === undefined) return;
    if (!eligible.includes(targetId)) return;

    yield* game.action.addCounter(targetId, CounterType.PlusOnePlusOne, n, sa.sourceCardId);
  }
}

effectRegistry.register(ReinforceEffect);

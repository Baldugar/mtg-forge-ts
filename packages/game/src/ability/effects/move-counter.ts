// SPDX-License-Identifier: GPL-3.0-or-later
// MoveCounterEffect — Forge `SP$ MoveCounter` (Bioshift, Power Conduit,
// Vorel of the Hull Clade). Moves N counters of a given type from one
// permanent to another.
//
// Forge DSL examples:
//   A:SP$ MoveCounter | ValidTgts$ Creature | TargetMin$ 2 | TargetMax$ 2
//                    | TargetsWithSameController$ True | CounterType$ P1P1
//                    | CounterNum$ Any
//
// MVP scope:
//   - sa.targets[0] = source permanent, sa.targets[1] = destination permanent.
//   - CounterType$ literal.
//   - CounterNum$ literal/SVar number; "Any" → move ALL of that counter type.
//   - Routes through GameAction.removeCounter + GameAction.addCounter so the
//     replacement pipeline + counter events fire on both sides.
import type { CounterType, EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class MoveCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MoveCounter";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length < 2) return;
    const sourceId: EntityId = sa.targets[0] as EntityId;
    const destId: EntityId = sa.targets[1] as EntityId;

    const counterType = (
      hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "P1P1"
    ) as CounterType;

    const numRaw = hasParam(sa, "CounterNum") ? evaluateParamRaw(sa, "CounterNum") : "1";
    let amount: number;
    if (numRaw.trim() === "Any") {
      const srcCard = game.cards.get(sourceId);
      amount = srcCard ? (srcCard.counters.get(counterType) ?? 0) : 0;
    } else {
      amount = evaluateParamNumber(sa, "CounterNum", game);
    }
    if (amount <= 0) return;

    yield* game.action.removeCounter(sourceId, counterType, amount, sa.sourceCardId);
    yield* game.action.addCounter(destId, counterType, amount, sa.sourceCardId);
  }
}

effectRegistry.register(MoveCounterEffect);

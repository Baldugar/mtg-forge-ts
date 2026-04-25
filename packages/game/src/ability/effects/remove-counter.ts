// SPDX-License-Identifier: GPL-3.0-or-later
// RemoveCounterEffect — removes N counters of a given type from all targets.
import type { CounterType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class RemoveCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RemoveCounter";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const counterTypeRaw = evaluateParamRaw(sa, "CounterType");
    const counterType = counterTypeRaw as CounterType;
    const n = evaluateParamNumber(sa, "CounterNum", game);
    for (const targetId of sa.targets) {
      yield* game.action.removeCounter(targetId, counterType, n, sa.sourceCardId);
    }
  }
}

effectRegistry.register(RemoveCounterEffect);

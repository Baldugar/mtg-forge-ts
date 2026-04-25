// SPDX-License-Identifier: GPL-3.0-or-later
// PutCounterEffect — adds N counters of a given type to all targets.
// handlerKey "PutCounter" matches Forge's canonical name for AddCounter effects.
import type { CounterType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PutCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PutCounter";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const counterTypeRaw = evaluateParamRaw(sa, "CounterType");
    const counterType = counterTypeRaw as CounterType;
    const n = evaluateParamNumber(sa, "CounterNum", game);
    for (const targetId of sa.targets) {
      yield* game.action.addCounter(targetId, counterType, n, sa.sourceCardId);
    }
  }
}

effectRegistry.register(PutCounterEffect);

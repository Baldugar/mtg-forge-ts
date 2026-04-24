// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class LoseLifeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "LoseLife";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "LifeAmount", game);
    yield* game.action.changeLife(sa.controllerSeat, -n, { cause: "effect" });
  }
}

effectRegistry.register(LoseLifeEffect);

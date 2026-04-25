// SPDX-License-Identifier: GPL-3.0-or-later
// ScryEffect — scries ScryNum$ N cards. Yields a scry decision request to
// the driver (the game engine pauses for the controller to order the cards).
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ScryEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Scry";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "ScryNum", game);
    yield* game.action.scry(sa.controllerSeat, n);
  }
}

effectRegistry.register(ScryEffect);

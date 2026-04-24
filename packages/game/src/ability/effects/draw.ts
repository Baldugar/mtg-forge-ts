// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class DrawEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Draw";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "NumCards", game);
    // For M7 MVP: defaults to controller. Forge's Defined$ field extends this later.
    yield* game.action.drawCards(sa.controllerSeat, n);
  }
}

effectRegistry.register(DrawEffect);

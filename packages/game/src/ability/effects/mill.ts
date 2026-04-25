// SPDX-License-Identifier: GPL-3.0-or-later
// MillEffect — mills NumCards$ cards from the top of the controller's library.
// MVP: target player = controller; Defined$ support deferred to Part D2.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class MillEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Mill";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = evaluateParamNumber(sa, "NumCards", game);
    yield* game.action.mill(sa.controllerSeat, n);
  }
}

effectRegistry.register(MillEffect);

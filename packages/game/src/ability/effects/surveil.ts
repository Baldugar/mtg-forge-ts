// SPDX-License-Identifier: GPL-3.0-or-later
// SurveilEffect — handles Forge's `SP$ Surveil` effect line.
// Look at the top N cards of the controller's (or target player's) library;
// put any number in their graveyard and the rest on top in any order.
//
// Forge DSL:
//   SP$ Surveil | Defined$ You | Amount$ 1
//   SP$ Surveil | Defined$ You | Amount$ 2
//   SP$ Surveil | Defined$ Targeted | Amount$ 1
//
// Mechanically mirrors ScryEffect but routes surveilled cards to the graveyard
// instead of the bottom of the library. The engine already has game.action.surveil
// wired up in SP2 (see game-action.ts), so we delegate to it here.
//
// Surveil player resolution:
//   You / self / absent → controllerSeat
//   Targeted             → first target's seat (deferred, falls back to controller)
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class SurveilEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Surveil";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";

    // Resolve target seat — MVP: always controller.
    // TODO(SP3): when Targeted is supported, resolve from sa.targets[0].
    let seat = sa.controllerSeat;
    if (definedRaw.toLowerCase() === "you" || definedRaw.toLowerCase() === "self") {
      seat = sa.controllerSeat;
    }

    yield* game.action.surveil(seat, n);
  }
}

effectRegistry.register(SurveilEffect);

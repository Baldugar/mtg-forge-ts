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
//
// Wave 77 — the runtime surveil count is `baseN + surveilNumModifier(seat)`
// where the modifier is the sum of Amount$ values from all active
// SurveilNum statics matching the surveiling player. Niv-Mizzet, Parun-
// shape effects ("you surveil 1 additional time") and surveil-deck
// synergies that augment the canonical count without changing the
// printed amount on the source effect.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { surveilNumModifier } from "../../statics/wave77-gate-helpers.js";
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

    // Wave 77 — layer the SurveilNum static modifier on the printed count.
    // Clamp at 0 so a hypothetical negative-modifier static can't push the
    // count below zero (game.action.surveil rejects count <= 0).
    const total = Math.max(0, n + surveilNumModifier(game, seat));
    if (total <= 0) return;
    yield* game.action.surveil(seat, total);
  }
}

effectRegistry.register(SurveilEffect);

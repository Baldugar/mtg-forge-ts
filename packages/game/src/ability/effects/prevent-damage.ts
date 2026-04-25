// SPDX-License-Identifier: GPL-3.0-or-later
// PreventDamageEffect — adds N to a player's damage-prevention shield.
//
// Forge DSL:
//   SP$ PreventDamage | ValidTarget$ You | Amount$ 5
//   SP$ PreventDamage | ValidTarget$ Opponent | Amount$ 3
//
// Forge `ValidTarget$` values mapped here:
//   You / YouCtrl  → sa.controllerSeat
//   Opponent       → the other seat (2-player assumption for MVP)
//   (absent)       → defaults to You
//
// Consumption of the shield (intercepting incoming damage via the
// replacement-ability pipeline) is deferred to SP3/F2. This effect
// simply increments `player.damagePreventionShield` so the value is
// visible to tests and future replacement handlers.
import type { PlayerSeat } from "@mtg-forge-ts/core";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PreventDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PreventDamage";

  // Non-generator override: PreventDamage mutates a player field synchronously
  // and does not need to pause for decisions or emit engine events. We return
  // an empty generator to satisfy the Generator<EngineYield,void,unknown> type.
  override resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amount = evaluateParamNumber(sa, "Amount", game);
    const targetRaw = hasParam(sa, "ValidTarget") ? evaluateParamRaw(sa, "ValidTarget") : "You";
    const controllerNum = sa.controllerSeat as unknown as number;
    let seat: PlayerSeat;
    if (targetRaw === "Opponent") {
      // 2-player assumption: the opponent is whichever seat is not the controller.
      seat = mkPlayerSeat(controllerNum === 0 ? 1 : 0);
    } else {
      // You / YouCtrl / default
      seat = sa.controllerSeat;
    }
    const player = game.getPlayer(seat);
    player.damagePreventionShield = (player.damagePreventionShield ?? 0) + amount;

    // Return an exhausted generator (no yields needed for this synchronous op).
    return (function* (): Generator<EngineYield, void, unknown> {
      /* intentionally empty */
    })();
  }
}

effectRegistry.register(PreventDamageEffect);

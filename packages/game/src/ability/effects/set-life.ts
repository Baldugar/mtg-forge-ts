// SPDX-License-Identifier: GPL-3.0-or-later
// SetLifeEffect — Forge `SP$ SetLife` (Beacon of Immortality, Blessed Wind).
// Sets a player's life total to a specific value (LifeAmount$). Implemented
// as a delta through GameAction.changeLife so the standard replacement
// pipeline + LifeChanged event fire (consistent with GainLife/LoseLife).
//
// Forge DSL examples:
//   A:SP$ SetLife | ValidTgts$ Player | LifeAmount$ X
//   A:SP$ SetLife | ValidTgts$ Player | LifeAmount$ 20
//
// Recipient resolution mirrors AddTurnEffect: targets first, then Defined$,
// else controller. LifeAmount$ supports SVar evaluation via the standard
// evaluateParamNumber path (X-cost, computed values, etc.).
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const resolveDefinedPlayer = (raw: string, sa: SpellAbility): PlayerSeat => {
  const trimmed = raw.trim();
  if (trimmed === "Player.Opponent" || trimmed === "Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return mkPlayerSeat(n === 0 ? 1 : 0);
  }
  return sa.controllerSeat;
};

export class SetLifeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "SetLife";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const target = evaluateParamNumber(sa, "LifeAmount", game);

    // Determine recipients.
    const recipients: PlayerSeat[] = [];
    if (sa.targets.length > 0) {
      for (const t of sa.targets) {
        recipients.push(t as unknown as PlayerSeat);
      }
    } else if (hasParam(sa, "Defined")) {
      recipients.push(resolveDefinedPlayer(evaluateParamRaw(sa, "Defined"), sa));
    } else {
      recipients.push(sa.controllerSeat);
    }

    for (const seat of recipients) {
      const player = game.getPlayer(seat);
      const delta = target - player.life;
      if (delta === 0) continue;
      yield* game.action.changeLife(seat, delta, { cause: "setLife" });
    }
  }
}

effectRegistry.register(SetLifeEffect);

// SPDX-License-Identifier: GPL-3.0-or-later
// RevealHandEffect — handles Forge's `SP$ RevealHand` effect line.
// Reveals the hand of a target player to all players. Emits CardsRevealed
// event (Wave 4).
//
// Forge DSL:
//   SP$ RevealHand | Defined$ Player.Opponent
//   SP$ RevealHand | Defined$ Player.You
//   SP$ RevealHand | Defined$ Targeted
import { ZoneType, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * Resolve "Defined$ Player.X" token to a PlayerSeat.
 * Default is "Player.Opponent" (the most common RevealHand usage).
 */
const resolvePlayerSeat = (raw: string, sa: SpellAbility) => {
  const controllerNum = sa.controllerSeat as unknown as number;
  if (raw === "Player.You" || raw === "You") {
    return sa.controllerSeat;
  }
  // Player.Opponent / Opponent / Targeted / default → opponent (2-player)
  return mkPlayerSeat(controllerNum === 0 ? 1 : 0);
};

export class RevealHandEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RevealHand";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Player.Opponent";
    const seat = resolvePlayerSeat(definedRaw, sa);

    const player = game.getPlayer(seat);
    const hand = player.zones.get(ZoneType.Hand);
    if (!hand) return;

    const ids = hand.toArray();
    if (ids.length === 0) return;

    yield game.emitEvent(
      mkEvent("CardsRevealed", game.turn, game.phase, {
        revealedBy: seat,
        revealedTo: "all",
        cardIds: ids,
        fromZone: ZoneType.Hand,
      }),
    );
  }
}

effectRegistry.register(RevealHandEffect);

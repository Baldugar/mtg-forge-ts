// SPDX-License-Identifier: GPL-3.0-or-later
// PeekAndRevealEffect — look at the top N cards of a player's library and
// reveal them to all players. Emits CardsRevealed event (Wave 4).
//
// Forge DSL:
//   SP$ PeekAndReveal | Defined$ Player.Opponent | NumCards$ 1
//   SP$ PeekAndReveal | Defined$ Player.You | NumCards$ 3
//
// Library order is NOT disturbed — cards stay on top of the library.
// The reveal is informational only; no cards move zones.
import { ZoneType, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * Resolve a Forge "Defined$ Player.X" token to a PlayerSeat.
 * Supports: Player.You (→ controller), Player.Opponent (→ 2-player opp),
 * Player.Targeted (→ controller as fallback, used for Targeted variants).
 * All other values fall through to controller seat.
 */
const resolvePlayerSeat = (raw: string, sa: SpellAbility) => {
  const controllerNum = sa.controllerSeat as unknown as number;
  if (raw === "Player.Opponent" || raw === "Opponent") {
    return mkPlayerSeat(controllerNum === 0 ? 1 : 0);
  }
  // Player.You / Player.Controller / Player.Targeted / fallback → controller
  return sa.controllerSeat;
};

export class PeekAndRevealEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PeekAndReveal";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumCards") ? evaluateParamNumber(sa, "NumCards", game) : 1;
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Player.You";
    const seat = resolvePlayerSeat(definedRaw, sa);

    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;

    // Peek top N without removing — toArray()[0] is the topmost card.
    const ids = lib.toArray().slice(0, num);
    if (ids.length === 0) return;

    yield game.emitEvent(
      mkEvent("CardsRevealed", game.turn, game.phase, {
        revealedBy: seat,
        revealedTo: "all",
        cardIds: ids,
        fromZone: ZoneType.Library,
      }),
    );
  }
}

effectRegistry.register(PeekAndRevealEffect);

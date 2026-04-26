// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5a/b/c — player-loss SBA collectors.
//
// CR 704.5a — A player with 0 or less life loses the game.
// CR 704.5b — A player who was required to draw from an empty library since
//            the last time SBAs were checked loses (flagged via
//            Player.failedDrawFromEmptyLibrary).
// CR 704.5c — A player with ten or more poison counters loses. The bound is
//            readable off game.rules.poisonCountersToLose so 2HG-style
//            15-counter rules can opt in without a separate code path.
//
// Future extension: "you don't lose the game at 0 life" static abilities
// (Phyrexian Unlife, Worship). Handled by consulting
// game.staticEffectRegistry.byCategory("ruleChanging") — deferred to a
// rule-changing helper (future task or SP3).
import { CounterType } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

export const collectLossConditions = (
  game: Game,
  out: SbaAction[],
  // Batch D2 — seats whose loss-condition SBA was prevented by a
  // replacement effect (e.g. Platinum Angel) earlier in the same sweep.
  // Skipping these seats stops the SBA loop from hot-spinning on a
  // perpetually-prevented loss; the per-sweep set is reset at the
  // start of the next sweep so removal of the Angel allows the loss to
  // proceed at the next priority pass.
  preventedThisSweep: ReadonlySet<PlayerSeat> = new Set(),
): void => {
  for (const p of game.players) {
    // Skip players already marked as lost — CR 704.6 — once a player has
    // lost, no further SBAs target them. A concurrent loss for an already-
    // dead player would re-enter the apply pipeline.
    if (hasLost(game, p.seat)) continue;
    // Skip players whose loss-condition was prevented earlier in THIS
    // sweep (Platinum Angel etc.).
    if (preventedThisSweep.has(p.seat)) continue;

    if (p.life <= 0) {
      out.push({ kind: "playerLosesLifeZero", seat: p.seat });
    }

    const poison = p.counters.get(CounterType.Poison) ?? 0;
    if (poison >= game.rules.poisonCountersToLose) {
      out.push({ kind: "playerLosesPoison", seat: p.seat, poisonCount: poison });
    }

    if (p.failedDrawFromEmptyLibrary) {
      out.push({ kind: "playerLosesEmptyDraw", seat: p.seat });
    }
  }
};

const hasLost = (game: Game, seat: PlayerSeat): boolean => {
  const t = game.terminalState;
  if (t === null) return false;
  // concededSeats is the SP1-era losses-list proxy; any future loss-taxonomy
  // enrichment (Task 68) will put the full roster here. For SP2, the engine
  // overwrites terminalState each SBA sweep so the concededSeats array is
  // the cumulative set of lost-or-conceded players.
  return t.concededSeats.includes(seat);
};

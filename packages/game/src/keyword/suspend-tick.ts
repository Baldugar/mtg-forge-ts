// SPDX-License-Identifier: GPL-3.0-or-later
// Suspend tick helper — at each of an active player's upkeeps, every card in
// the shared Exile zone that is "suspended by" that player decrements one
// time counter. CR 702.61b — "At the beginning of each player's upkeep,
// remove a time counter from each suspended card that player owns."
//
// Wave 26 MVP: ownership in this engine is tracked via Card.ownerSeat. We
// iterate every live card whose zone is Exile, suspendedCounters > 0, and
// ownerSeat === activeSeat, decrementing by one. Reaching 0 leaves the card
// eligible for the Suspend AltCost (altcost/suspend.ts) on the controller's
// next priority window.
//
// This helper is NOT yet wired into PhaseHandler.performTurnBasedActions —
// once Upkeep step gets a turn-based action slot in SP4, callers can invoke
// this from there. Tests invoke it directly.
import type { PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Decrement `suspendedCounters` by 1 on every Exile-zone card owned by
 * `activeSeat` that has a positive count. Returns the list of card ids
 * whose counters reached 0 on this tick (so callers can drive the
 * subsequent free-cast offer).
 */
export const tickSuspendedCards = (game: Game, activeSeat: PlayerSeat): readonly number[] => {
  const drained: number[] = [];
  for (const [id, card] of game.cards) {
    if (card.ownerSeat !== activeSeat) continue;
    if (card.zone !== ZoneType.Exile) continue;
    if (card.suspendedCounters === undefined) continue;
    if (card.suspendedCounters <= 0) continue;
    card.suspendedCounters -= 1;
    if (card.suspendedCounters === 0) drained.push(id as number);
  }
  return drained;
};

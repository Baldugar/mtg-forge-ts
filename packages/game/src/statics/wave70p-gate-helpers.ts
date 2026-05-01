// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — query helpers for the five Wave-70.P static modes:
//   - CanBlockIfReach    → canBlockIfReach    (consumed by block-restrictions
//                                                 flying check; mirrors Wave
//                                                 70.F's ignoresLandWalk)
//   - CantBecomeMonarch  → canBecomeMonarch   (consumed by monarch-tracker
//                                                 grantMonarch; mirrors Wave
//                                                 70.O's canPhaseIn)
//   - CantChangeDayTime  → canChangeDayTimeTo (consumed by day-night-tracker
//                                                 transitions; gate proposed
//                                                 NewTime$ values)
//   - TurnReversed       → isTurnOrderReversed (forward-compat read for SP4
//                                                  turn-order machinery)
//   - PhaseReversed      → isPhaseOrderReversed (forward-compat read for
//                                                  SP4 phase-advance machinery)
//
// Each helper walks the staticEffectRegistry by mode and returns a
// boolean the consumer site uses to override the canonical rules
// behavior at the matching decision point.
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D-O. The static registry already snapshots
// and restores cleanly, so walking the registry per-query is the
// right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CanBlockIfReachPayload } from "../static/handlers/can-block-if-reach-static.js";
import type { CantBecomeMonarchPayload } from "../static/handlers/cant-become-monarch-static.js";
import type {
  CantChangeDayTimePayload,
  DayNightState,
} from "../static/handlers/cant-change-day-time-static.js";
import type { PhaseReversedPayload } from "../static/handlers/phase-reversed-static.js";
import type { TurnReversedPayload } from "../static/handlers/turn-reversed-static.js";

/**
 * True iff the (blockerId, attackerId) pairing should bypass the
 * flying-keyword rejection (CR 702.9 / 702.17). The block-restrictions
 * module's flying check calls this gate before rejecting; on a match
 * the rejection is suppressed and the block is allowed to stand.
 *
 * Mirrors Wave 70.F's `ignoresLandWalk` — both predicates must match:
 * a static targeting only specific blockers (ValidBlocker$
 * Creature.Bear) only opens the gate for those blockers, and an
 * attacker-scoped static (ValidAttacker$ Dragon) only relaxes flying
 * rejection for those attackers.
 *
 * Forge equivalent: `StaticAbilityCanBlockIfReach.canBlockIfReach`.
 */
export const canBlockIfReach = (game: Game, blockerId: EntityId, attackerId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CanBlockIfReach");
  for (const s of statics) {
    const payload = s.describe() as CanBlockIfReachPayload;
    if (!payload || payload.kind !== "canBlockIfReach") continue;
    if (!payload.blockerMatches(blockerId, game)) continue;
    if (!payload.attackerMatches(attackerId, game)) continue;
    return true;
  }
  return false;
};

/**
 * True iff `seat` may legally become the monarch (CR 716). False iff
 * any active CantBecomeMonarch static matches the seat. Consumed by
 * `grantMonarch` in monarch-tracker; on rejection the grant no-ops
 * silently — no BecameMonarch event fires, the prior monarch (if
 * any) stays unchanged.
 *
 * Forge equivalent: `StaticAbilityCantBecomeMonarch.cantBecomeMonarch`.
 */
export const canBecomeMonarch = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantBecomeMonarch");
  for (const s of statics) {
    const payload = s.describe() as CantBecomeMonarchPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

/**
 * True iff the day/night state may transition to `proposed` (CR 726).
 * False iff any active CantChangeDayTime static matches the proposed
 * new time. Consumed by `tryUpkeepTransition` in day-night-tracker
 * (and any explicit setDayNight call site); on rejection the
 * transition no-ops silently — no DayTimeChanged event fires, the
 * daybound/nightbound auto-flip is skipped.
 *
 * Forge equivalent: `StaticAbilityCantChangeDayTime.cantChangeDayTime`.
 */
export const canChangeDayTimeTo = (game: Game, proposed: DayNightState): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantChangeDayTime");
  for (const s of statics) {
    const payload = s.describe() as CantChangeDayTimePayload;
    if (!payload || payload.kind !== "cantChangeDayTime") continue;
    if (payload.newTimeMatches(proposed)) return false;
  }
  return true;
};

/**
 * True iff turn order is reversed for the matching seat (CR 103.7).
 * Wave 106 closure of the prior consumer-side TODO(advanced): the
 * PhaseHandler now consults `nextActiveSeatInTurnOrder` (below) when
 * refilling the turn queue, which uses this gate to flip the seat
 * advance direction.
 *
 * Returns true when ANY active TurnReversed static covers the given
 * seat; the gate is symmetric (both directions reverse together) so
 * the seat parameter is informational only at MVP scope.
 *
 * Forge equivalent: `StaticAbilityTurnFaceUp.isTurnOrderReversed`.
 */
export const isTurnOrderReversed = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("TurnReversed");
  for (const s of statics) {
    const payload = s.describe() as TurnReversedPayload;
    if (!payload || payload.kind !== "turnReversed") continue;
    if (payload.playerMatches(seat)) return true;
  }
  return false;
};

/**
 * Wave 106 — Compute the seat that should hold priority next, given the
 * just-finished turn's active seat. Walks the player roster in seat
 * order and returns:
 *   - the next seat (mod player count) when no TurnReversed static
 *     covers the just-finished active seat — the canonical CR 103.7
 *     forward direction;
 *   - the previous seat (mod player count) when an active TurnReversed
 *     static matches — Topsy Turvy + 3+-player corpus shape.
 *
 * Defensively returns the same seat when only one live player remains
 * (the loser-elimination path will be invoked separately by the SBA
 * loop) and `undefined` when there are no players (an error condition
 * the caller handles by terminating the run).
 */
export const nextActiveSeatInTurnOrder = (game: Game, justFinished: PlayerSeat): PlayerSeat | undefined => {
  const players = game.players;
  if (players.length === 0) return undefined;
  const idx = players.findIndex((p) => p.seat === justFinished);
  if (idx < 0) return players[0]?.seat;
  const reversed = isTurnOrderReversed(game, justFinished);
  const len = players.length;
  const nextIdx = reversed ? (idx - 1 + len) % len : (idx + 1) % len;
  return players[nextIdx]?.seat;
};

/**
 * True iff the phase order is reversed for the matching seat's turn
 * (CR 500). Forward-compat read for SP4 phase-advance machinery —
 * current MVP registration is a no-op at the consumer side; future
 * wiring of PhaseHandler.advancePhase reads this helper to flip the
 * step sequence.
 *
 * Forge equivalent: `StaticAbilityPhaseReversed.isPhaseOrderReversed`.
 */
export const isPhaseOrderReversed = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("PhaseReversed");
  for (const s of statics) {
    const payload = s.describe() as PhaseReversedPayload;
    if (!payload || payload.kind !== "phaseReversed") continue;
    if (payload.playerMatches(seat)) return true;
  }
  return false;
};

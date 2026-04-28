// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.F — MayLookAt$ peek-rights gate.
//
// Forge's `S:Mode$ Continuous | Affected$ <filter> | MayLookAt$ <player-filter>`
// grants the listed players permission to look at the face-down faces of
// filtered cards (in any zone). Common cards: Telepathy ("you may look at
// your opponents' hands"), Sen Triplets (peek + cast restriction), Glasses
// of Urza, Vampiric Tutor analogues.
//
// Implementation shape: a list of gate entries on the LayerEngine. Each
// entry carries a card-membership predicate (the static's Affected$
// filter) and a seat-membership predicate (the MayLookAt$ player filter).
// `mayLookAtFaceDown(game, cardId, seat)` walks the list and returns true
// iff at least one live gate admits both the card and the seat.
//
// Lifecycle:
//   - On static activation, the Continuous handler builds a `MayLookAtGate`
//     and pushes a `may-look-at` LayerPayload through the standard
//     pushLayerPayload contract.
//   - On static deactivation, removeLayerPayload splices the gate out by
//     reference (same referential-equality contract as kw-grant et al.).
//
// MVP scope:
//   - The gate is consulted by an explicit query helper. Visibility
//     consumers (face-down peek paths, hand-reveal paths) will call
//     `mayLookAtFaceDown` when probing face-down state. Full UI integration
//     (peek-prompt rendering, opponent-hand viewer) is out of Wave 60.F
//     scope; the gate is the engine-side contract that those consumers
//     read against.
//   - Player-filter parsing is MVP: "You", "Each", "Opponent" are the
//     three flagship Forge values. Unknown filters fall back to a
//     "everyone" admission so cards using exotic filters don't crash;
//     promoting to per-filter parity is a future tightening pass.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * A single MayLookAt$ gate. The card-membership predicate mirrors the
 * standard Wave 47 `appliesToCardIdFn`; the seat-membership predicate is
 * derived from the MayLookAt$ raw value at static-build time.
 */
export interface MayLookAtGate {
  /** The static ability id that produced this gate. */
  readonly sourceAbilityId: EntityId | null;
  /** Live filter predicate — re-evaluated on every query. */
  readonly appliesToCardIdFn: (cardId: EntityId) => boolean;
  /** Live seat predicate — does `seat` have peek rights via this gate? */
  readonly seatHasPeekRights: (seat: PlayerSeat) => boolean;
}

/**
 * Parse Forge's `MayLookAt$` raw value into a seat-membership predicate.
 * Forge's common values:
 *   - `You`     → static controller's seat (the card owner who registered
 *                 the static).
 *   - `Each`    → every seat may peek (Telepathy-style omnipresent peek).
 *   - `Opponent`→ controller's opponents only.
 * Unknown filters fall back to admit-all rather than admit-none so cards
 * using exotic filters don't accidentally clamp visibility.
 */
export const parseMayLookAtSeatFilter = (
  raw: string,
  controllerSeat: PlayerSeat,
): ((seat: PlayerSeat) => boolean) => {
  const norm = raw.trim();
  if (norm === "You") {
    return (seat: PlayerSeat) => seat === controllerSeat;
  }
  if (norm === "Each" || norm === "EachPlayer" || norm === "All" || norm === "Any") {
    return (_seat: PlayerSeat) => true;
  }
  if (norm === "Opponent" || norm === "Opponents" || norm === "EachOpponent") {
    return (seat: PlayerSeat) => seat !== controllerSeat;
  }
  // MVP fallback: admit-all. Future tightening can lift specific Forge
  // player-filter forms (Player.Targeted, Player.IsRemembered, etc.) into
  // dedicated branches here.
  return (_seat: PlayerSeat) => true;
};

/**
 * Public query: does `seat` have permission to look at the face-down face
 * of `cardId` via at least one live MayLookAt$ gate?
 *
 * Walk every gate; admit on first match. Empty gate-list short-circuits to
 * `false` (no permission unless explicitly granted).
 */
export const mayLookAtFaceDown = (game: Game, cardId: EntityId, seat: PlayerSeat): boolean => {
  const gates = game.layerEngine.mayLookAtGates;
  if (gates.length === 0) return false;
  for (const gate of gates) {
    if (!gate.appliesToCardIdFn(cardId)) continue;
    if (gate.seatHasPeekRights(seat)) return true;
  }
  return false;
};

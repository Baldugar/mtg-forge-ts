// SPDX-License-Identifier: GPL-3.0-or-later
// endGame — atomically writes Game.terminalState. Separate helper (not a
// Game method) so the event-emission half of end-of-game stays in the
// driver loop: endGame records the outcome on the model; the driver emits
// the GameEnded event so every observer (decision-log, UI, Match) reacts
// uniformly regardless of what kind of driver ran the game.
//
// Re-entry is an error, not a no-op — a controller or effect handler that
// tries to conclude an already-terminal game has a bug. Silent double-
// assignment would hide it.
//
// SP2 Task 68 enrichment: callers may pass `losses` (the per-player
// LossReason roster). When present, `endGame` derives `concededSeats`
// from the loss entries so the legacy roster stays synchronized without
// the caller having to build both. A fourth overload, `endGameCleanup`,
// handles CR 800.4 multi-player cleanup and emits GameEnded itself.
import type { PlayerSeat } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { PlayerLoss, TerminalOutcome } from "../terminal-state.js";
import { removePlayerFromGame } from "./leave-game.js";

export const endGame = (
  game: Game,
  outcome: TerminalOutcome,
  concededSeats: readonly PlayerSeat[] = [],
  losses: readonly PlayerLoss[] = [],
): void => {
  if (game.terminalState) {
    throw new GameStateIntegrityError("endGame: game is already in terminal state");
  }
  // If the caller didn't supply losses but did supply concededSeats,
  // synthesize a minimal PlayerLoss[] so downstream readers see a
  // consistent roster. We tag these with "concede" since SP1's concededSeats
  // API exclusively represented exit-by-concede.
  const effectiveLosses: readonly PlayerLoss[] =
    losses.length > 0 ? losses : concededSeats.map((seat) => ({ seat, reason: "concede" as const }));
  // Mirror the inverse direction too: if losses were supplied but
  // concededSeats wasn't, derive concededSeats from losses whose reason is
  // "concede". This preserves the Match.recordGameResult predicate
  // (ts.concededSeats.length > 0 → reason: "concede") without breaking
  // callers that only populate the richer field.
  const effectiveConceded: readonly PlayerSeat[] =
    concededSeats.length > 0
      ? [...concededSeats]
      : effectiveLosses.filter((l) => l.reason === "concede").map((l) => l.seat);
  game.terminalState = {
    endedAt: { turn: game.turn, phase: game.phase },
    outcome,
    // WHY: defensive copy — callers that pass a mutable array could otherwise
    // mutate terminalState.concededSeats after assignment.
    concededSeats: effectiveConceded,
    losses: [...effectiveLosses],
  };
};

/**
 * SP2 Task 68 — full end-of-game flow as a generator. Writes terminalState
 * (via endGame), drives CR 800.4 cleanup for the losing seats (only when
 * the game has ≥3 players; 2-player games skip cleanup because the match
 * is resolving), and emits the GameEnded canonical event.
 *
 * Callers (priority orchestrator, SbaEngine) route through this rather
 * than calling endGame directly so the event-emission + cleanup plumbing
 * stays consistent.
 */
export function* endGameCleanup(
  game: Game,
  losses: readonly PlayerLoss[],
  opts?: { readonly concededSeats?: readonly PlayerSeat[] },
): Generator<EngineYield, void, unknown> {
  // Adjudicate outcome from the losses list.
  const losingSeats = new Set(losses.map((l) => l.seat));
  const surviving = game.players.filter((p) => !losingSeats.has(p.seat));
  let outcome: TerminalOutcome;
  if (surviving.length === 1 && surviving[0] !== undefined) {
    outcome = { kind: "win", winner: surviving[0].seat, reason: losses[0]?.reason ?? "effect" };
  } else {
    outcome = { kind: "draw", reason: losses[0]?.reason ?? "effect" };
  }
  // Write terminal state; derive concededSeats from losses when caller
  // didn't pass it through (backwards compat for match-level reads).
  endGame(game, outcome, opts?.concededSeats ?? [], losses);

  // CR 800.4 cleanup for each losing player (multiplayer only; in 2-
  // player the match simply ends).
  if (game.players.length >= 3) {
    for (const loss of losses) {
      yield* removePlayerFromGame(game, loss.seat);
    }
  }

  // GameEnded event. Payload reason is derived: "draw" on draw, "concede"
  // if any loss reason is "concede", "victory" otherwise.
  const anyConcede = losses.some((l) => l.reason === "concede");
  const reason: "victory" | "draw" | "concede" | "timeout" =
    outcome.kind === "draw" ? "draw" : anyConcede ? "concede" : "victory";
  const winners = outcome.kind === "win" ? [outcome.winner] : [];
  yield game.emitEvent(mkEvent("GameEnded", game.turn, game.phase, { winners, reason }));
}

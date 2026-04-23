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
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { TerminalOutcome } from "../terminal-state.js";

export const endGame = (
  game: Game,
  outcome: TerminalOutcome,
  concededSeats: readonly PlayerSeat[] = [],
): void => {
  if (game.terminalState) {
    throw new Error("endGame: game is already in terminal state");
  }
  game.terminalState = {
    endedAt: { turn: game.turn, phase: game.phase },
    outcome,
    // WHY: defensive copy — callers that pass a mutable array could otherwise
    // mutate terminalState.concededSeats after assignment.
    concededSeats: [...concededSeats],
  };
};

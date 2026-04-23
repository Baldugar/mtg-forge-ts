// SPDX-License-Identifier: GPL-3.0-or-later
// Terminal (game-over) descriptor. Immutable once set; EndOfGameHandler (Task
// 46's endGame helper) writes this on the Game and Game.isTerminal() reads
// it. The outcome is a discriminated union so draws (no winner) don't have
// to be modeled as "empty winners array" — the kind narrows the shape.
//
// endedAt records the turn + phase at which the game resolved so observers
// (UI, replay, stats) can tie the outcome back to a specific game-state
// snapshot without scanning the event log. concededSeats is a roster rather
// than a boolean on each player because match-level logic (Match.recordGame-
// Result) surfaces individual concedes independently of the win/draw/team-
// win discrimination.
import type { PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";

export type TerminalOutcome =
  | { readonly kind: "win"; readonly winner: PlayerSeat; readonly reason: string }
  | { readonly kind: "teamWin"; readonly teamId: number; readonly reason: string }
  | { readonly kind: "draw"; readonly reason: string };

export interface TerminalState {
  readonly endedAt: { readonly turn: number; readonly phase: PhaseStep };
  readonly outcome: TerminalOutcome;
  readonly concededSeats: readonly PlayerSeat[];
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Terminal (game-over) descriptor. Immutable once set; EndOfGameHandler sets
// this in Task 46 and Game.isTerminal() reads it.
import type { PlayerSeat } from "@mtg-forge-ts/core";

export interface TerminalState {
  readonly reason: "victory" | "draw" | "concede" | "timeout";
  readonly winners: readonly PlayerSeat[];
  readonly turn: number;
}

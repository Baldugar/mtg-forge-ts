// SPDX-License-Identifier: GPL-3.0-or-later
// Terminal (game-over) descriptor. Immutable once set; EndOfGameHandler (Task
// 46's endGame helper) writes this on the Game and Game.isTerminal() reads
// it. The outcome is a discriminated union so draws (no winner) don't have
// to be modeled as "empty winners array" — the kind narrows the shape.
//
// endedAt records the turn + phase at which the game resolved so observers
// (UI, replay, stats) can tie the outcome back to a specific game-state
// snapshot without scanning the event log.
//
// SP2 Task 68 enrichment — `losses` carries the full taxonomy of per-player
// loss reasons (CR 104.3 / 104.4). The legacy `concededSeats` field is
// retained for backward compatibility (SP1 tests + Match-level logic read
// it); Task 68 populates BOTH so callers can migrate at their own pace.
import type { PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";

export type TerminalOutcome =
  | { readonly kind: "win"; readonly winner: PlayerSeat; readonly reason: string }
  | { readonly kind: "teamWin"; readonly teamId: number; readonly reason: string }
  | { readonly kind: "draw"; readonly reason: string };

/**
 * SP2 Task 68 — per-player loss cause taxonomy. Maps to CR 104.3 (a-d).
 *
 *   lifeLoss       — CR 104.3b (a player whose life total is 0 or less
 *                    loses the game).
 *   poisonLoss     — CR 104.3c (a player with ten or more poison counters
 *                    loses). "tenPoison" kept as alias for test-count
 *                    stability with earlier drafts.
 *   libraryLoss    — CR 104.3d (a player who attempts to draw from an
 *                    empty library loses).
 *   concede        — CR 104.3a (a player may concede at any time).
 *   gameDrawn      — CR 104.4a simultaneous loss / mutual-agreement draw.
 *   commanderDamage— CR 903.10 commander-damage elimination.
 *   antePaid       — CR 407 ante-paid loss edge case.
 *   effect         — catch-all for card-induced losses ("you lose the
 *                    game" static effects) until SP3 fills in a richer
 *                    taxonomy.
 */
export type LossReason =
  | "lifeLoss"
  | "poisonLoss"
  | "tenPoison"
  | "libraryLoss"
  | "concede"
  | "gameDrawn"
  | "commanderDamage"
  | "antePaid"
  | "effect";

export interface PlayerLoss {
  readonly seat: PlayerSeat;
  readonly reason: LossReason;
}

export interface TerminalState {
  readonly endedAt: { readonly turn: number; readonly phase: PhaseStep };
  readonly outcome: TerminalOutcome;
  /**
   * SP1 legacy roster. Kept for backward compatibility (phase-handler +
   * match + integration tests read this). Contains the seats that
   * concede-like exited the game. Task 68 populates BOTH this field and
   * the richer `losses` roster so callers transition incrementally.
   */
  readonly concededSeats: readonly PlayerSeat[];
  /**
   * SP2 Task 68 enrichment — every player who has lost (whatever the
   * cause: life, poison, decked, concede, commander damage, etc.) with
   * their specific LossReason. Empty list = game hasn't resolved any
   * losses yet. On a final terminal state, length === total-losing-seats.
   *
   * Optional for backward compatibility with SP1 test constructors that
   * pre-dated the Task-68 migration. Readers treat `undefined` as an
   * empty list; writers constructed through endGame / SbaEngine always
   * populate it.
   */
  readonly losses?: readonly PlayerLoss[];
}

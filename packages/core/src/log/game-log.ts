// SPDX-License-Identifier: GPL-3.0-or-later
// GameLog — append-only log of engine-emitted events (spellcast, phase change,
// damage dealt, decision prompt, etc.) for replay UI and debugging.
//
// Verbosity gates both ingestion (append drops entries above the configured
// floor) and egress (filter() narrows after the fact). Core types stay
// subsystem-agnostic: `phase` is a string rather than the PhaseStep enum so
// game-layer consumers can stringify any phase identifier without forcing a
// core-level dependency on their enum.

import type { EntityId, PlayerSeat } from "../ids.js";

/**
 * Log verbosity levels, ordered from quietest to loudest. Entries with
 * verbosity ≤ the log's minVerbosity are kept; higher values are dropped.
 *
 * - Silent — disabled; no entries ever survive append().
 * - Errors — only structural / integrity events; survives even when noisy
 *   channels are disabled.
 * - Public  — everything a spectator of a public game would see.
 * - Private — adds per-seat private info (hand reveals, AI reasoning hooks).
 * - Debug   — engine-internal trace (pump entries, phase-queue diagnostics).
 */
export enum GameLogVerbosity {
  Silent = 0,
  Errors = 1,
  Public = 2,
  Private = 3,
  Debug = 4,
}

/**
 * Single log entry. `subject` and `actor` are optional because many engine
 * events (phase transitions, turn-number bumps) have no single actor or
 * target. Consumers serialize `at.phase` as a string (e.g. PhaseStep enum
 * value) — see the module header for the rationale.
 */
export interface GameLogEntry {
  readonly at: { readonly turn: number; readonly phase: string };
  readonly verbosity: GameLogVerbosity;
  readonly message: string;
  readonly subject?: EntityId;
  readonly actor?: PlayerSeat;
}

/** Snapshot shape for toJSON / fromJSON round-trips. */
export interface GameLogSnapshot {
  readonly minVerbosity: GameLogVerbosity;
  readonly entries: readonly GameLogEntry[];
}

/**
 * Append-only log with verbosity gating. `append` is the only mutator; `all`
 * and `filter` return views. `toJSON` / `fromJSON` provide lossless round-trip
 * for snapshot/replay pipelines.
 */
export class GameLog {
  private readonly entries: GameLogEntry[] = [];

  constructor(public minVerbosity: GameLogVerbosity = GameLogVerbosity.Public) {}

  /** Appends `entry` iff its verbosity is ≤ this log's minVerbosity. */
  append(entry: GameLogEntry): void {
    if (entry.verbosity <= this.minVerbosity) this.entries.push(entry);
  }

  /** All entries that survived `append`, in insertion order. */
  all(): readonly GameLogEntry[] {
    return this.entries;
  }

  /** Entries with verbosity ≤ `v`. Does not mutate this log. */
  filter(v: GameLogVerbosity): GameLogEntry[] {
    return this.entries.filter((e) => e.verbosity <= v);
  }

  /**
   * Serialize to a plain object that survives JSON round-trip. Entries are
   * copied so later mutations on the snapshot do not bleed into this log.
   */
  toJSON(): GameLogSnapshot {
    return { minVerbosity: this.minVerbosity, entries: [...this.entries] };
  }

  /**
   * Restore a log from `toJSON` output. Bypasses `append`'s verbosity gate —
   * the snapshot is considered already filtered.
   */
  static fromJSON(s: GameLogSnapshot): GameLog {
    const log = new GameLog(s.minVerbosity);
    for (const e of s.entries) log.entries.push(e);
    return log;
  }
}

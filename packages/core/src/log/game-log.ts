// SPDX-License-Identifier: GPL-3.0-or-later
// GameLog — append-only log of engine-emitted events (spellcast, phase change,
// damage dealt, decision prompt, etc.) for replay UI and debugging.
//
// Forge's model (forge.game.GameLogEntryType + GameLogVerbosity) classifies
// entries by a 19-value type enum, and each verbosity is a Set<GameLogEntryType>
// of types to include. Our SP1 port keeps the five-level ordinal
// `GameLogVerbosity` for backward compatibility with early tests, but is now
// primarily a mapping to an explicit type-set via VERBOSITY_TYPES.
//
// At append time, an entry survives iff:
//   - the log's `includeTypes` Set contains `entry.type` (when provided), AND
//   - the log's `minVerbosity` preset admits `entry.type` (when provided).
// If neither filter was configured, all entries are kept. This lets callers
// compose both a type allow-list (UI toggles) and a coarse verbosity preset
// (low/medium/high/debug) without them stepping on each other.
//
// `at` carries optional turn+phase context (phase is a string so core need not
// import PhaseStep from the game package).

import type { EntityId } from "../ids.js";

/**
 * Forge's forge.game.GameLogEntryType — 19 categories that classify every
 * engine-emitted log line. String values match Forge's Java `name()` so
 * serialized logs round-trip across the TS/Java boundary (SP4 wire interop).
 */
export enum GameLogEntryType {
  GameOutcome = "GAME_OUTCOME",
  MatchResults = "MATCH_RESULTS",
  Turn = "TURN",
  Mulligan = "MULLIGAN",
  Ante = "ANTE",
  Draft = "DRAFT",
  ZoneChange = "ZONE_CHANGE",
  PlayerControl = "PLAYER_CONTROL",
  Damage = "DAMAGE",
  Life = "LIFE",
  Land = "LAND",
  Discard = "DISCARD",
  Combat = "COMBAT",
  Information = "INFORMATION",
  StackResolve = "STACK_RESOLVE",
  StackAdd = "STACK_ADD",
  EffectReplaced = "EFFECT_REPLACED",
  Mana = "MANA",
  Phase = "PHASE",
}

/** All GameLogEntryType members, handy for constructing "everything" Sets. */
export const ALL_GAME_LOG_ENTRY_TYPES: readonly GameLogEntryType[] = [
  GameLogEntryType.GameOutcome,
  GameLogEntryType.MatchResults,
  GameLogEntryType.Turn,
  GameLogEntryType.Mulligan,
  GameLogEntryType.Ante,
  GameLogEntryType.Draft,
  GameLogEntryType.ZoneChange,
  GameLogEntryType.PlayerControl,
  GameLogEntryType.Damage,
  GameLogEntryType.Life,
  GameLogEntryType.Land,
  GameLogEntryType.Discard,
  GameLogEntryType.Combat,
  GameLogEntryType.Information,
  GameLogEntryType.StackResolve,
  GameLogEntryType.StackAdd,
  GameLogEntryType.EffectReplaced,
  GameLogEntryType.Mana,
  GameLogEntryType.Phase,
];

/**
 * Ordinal verbosity levels retained from SP1 for back-compat with early tests
 * and external tooling. New code should prefer `includeTypes`-based filtering;
 * this enum maps via `VERBOSITY_TYPES` to concrete `GameLogEntryType` sets.
 *
 * - Silent — keeps nothing.
 * - Errors — only structural outcome events (GameOutcome).
 * - Public — what a spectator sees (Forge's MEDIUM preset — 13 types).
 * - Private — adds Information + EffectReplaced + remaining verbose types
 *   (Forge's HIGH preset — all 19 types).
 * - Debug — same as Private in SP1; future debug-only types may widen it.
 */
export enum GameLogVerbosity {
  Silent = 0,
  Errors = 1,
  Public = 2,
  Private = 3,
  Debug = 4,
}

/**
 * Verbosity → set-of-types mapping. Derived from Forge's GameLogVerbosity.java
 * LOW/MEDIUM/HIGH presets, extended with SP1's Silent/Errors/Debug layers.
 *
 * - Silent: nothing.
 * - Errors: just the terminal GameOutcome (matches Forge's LOW minus ambient
 *   turn/mulligan noise; keeps end-of-game reachable even in quiet mode).
 * - Public: Forge's MEDIUM preset verbatim — 13 types excluding Information,
 *   EffectReplaced, Mana, PlayerControl, Phase, Draft.
 * - Private: Forge's HIGH preset — every type.
 * - Debug: currently equals Private. New debug-only types can be added to
 *   this set without disturbing HIGH's one-to-one mapping to Forge.
 */
export const VERBOSITY_TYPES: Readonly<Record<GameLogVerbosity, ReadonlySet<GameLogEntryType>>> = {
  [GameLogVerbosity.Silent]: new Set<GameLogEntryType>(),
  [GameLogVerbosity.Errors]: new Set<GameLogEntryType>([GameLogEntryType.GameOutcome]),
  [GameLogVerbosity.Public]: new Set<GameLogEntryType>([
    GameLogEntryType.GameOutcome,
    GameLogEntryType.MatchResults,
    GameLogEntryType.Turn,
    GameLogEntryType.Mulligan,
    GameLogEntryType.Ante,
    GameLogEntryType.Damage,
    GameLogEntryType.ZoneChange,
    GameLogEntryType.Land,
    GameLogEntryType.Discard,
    GameLogEntryType.Combat,
    GameLogEntryType.StackAdd,
    GameLogEntryType.StackResolve,
    GameLogEntryType.Life,
  ]),
  [GameLogVerbosity.Private]: new Set<GameLogEntryType>(ALL_GAME_LOG_ENTRY_TYPES),
  [GameLogVerbosity.Debug]: new Set<GameLogEntryType>(ALL_GAME_LOG_ENTRY_TYPES),
};

/**
 * Single log entry. Type is now the primary classification; `message` is the
 * human-readable caption. `at` is optional turn+phase context, and
 * `sourceCardId` is the Forge-aligned attribution field (Forge's
 * GameLogEntry.sourceCardId).
 */
export interface GameLogEntry {
  readonly type: GameLogEntryType;
  readonly message: string;
  readonly sourceCardId?: EntityId;
  readonly at?: { readonly turn: number; readonly phase: string };
}

/** Snapshot shape for toJSON / fromJSON round-trips. */
export interface GameLogSnapshot {
  readonly minVerbosity: GameLogVerbosity;
  readonly includeTypes: readonly GameLogEntryType[] | null;
  readonly entries: readonly GameLogEntry[];
}

/**
 * GameLog constructor options. Callers supply either/both filters; absent
 * filters mean "no filtering on that axis". The `append` gate applies both:
 * an entry must pass every configured filter to be kept.
 */
export interface GameLogOptions {
  readonly minVerbosity?: GameLogVerbosity;
  readonly includeTypes?: ReadonlySet<GameLogEntryType>;
}

/**
 * Append-only log with type + verbosity gating. `append` is the only mutator;
 * `all`, `filter`, and `filterByType` return views. `toJSON` / `fromJSON`
 * provide lossless round-trip for snapshot/replay pipelines.
 */
export class GameLog {
  private readonly entries: GameLogEntry[] = [];
  readonly minVerbosity: GameLogVerbosity;
  private readonly includeTypes: ReadonlySet<GameLogEntryType> | null;

  constructor(opts: GameLogOptions = {}) {
    this.minVerbosity = opts.minVerbosity ?? GameLogVerbosity.Public;
    this.includeTypes = opts.includeTypes ?? null;
  }

  /**
   * Returns true iff `type` is admitted by this log's filters. Exposed so
   * producers can skip building an entry they'd be about to drop — Forge's
   * GameLog.getLogEntries(type) does an analogous check at emission time.
   */
  accepts(type: GameLogEntryType): boolean {
    if (this.includeTypes !== null && !this.includeTypes.has(type)) return false;
    const preset = VERBOSITY_TYPES[this.minVerbosity];
    return preset.has(type);
  }

  /** Appends `entry` iff both the type filter and verbosity preset admit it. */
  append(entry: GameLogEntry): void {
    if (this.accepts(entry.type)) this.entries.push(entry);
  }

  /** All entries that survived `append`, in insertion order. */
  all(): readonly GameLogEntry[] {
    return this.entries;
  }

  /**
   * Entries whose type is in `types`. Preferred filtering method — mirrors
   * Forge's GameLog.getLogEntries(Set<GameLogEntryType>) shape.
   */
  filterByType(types: ReadonlySet<GameLogEntryType>): GameLogEntry[] {
    return this.entries.filter((e) => types.has(e.type));
  }

  /**
   * Legacy ordinal filter — returns entries whose type is in the preset for
   * verbosity `v`. Kept for SP1 back-compat; new callers should prefer
   * `filterByType`.
   */
  filter(v: GameLogVerbosity): GameLogEntry[] {
    return this.filterByType(VERBOSITY_TYPES[v]);
  }

  /**
   * Serialize to a plain object that survives JSON round-trip. Entries are
   * copied so later mutations on the snapshot do not bleed into this log.
   */
  toJSON(): GameLogSnapshot {
    return {
      minVerbosity: this.minVerbosity,
      includeTypes: this.includeTypes === null ? null : [...this.includeTypes],
      entries: [...this.entries],
    };
  }

  /**
   * Restore a log from `toJSON` output. Bypasses `append`'s filter gate — the
   * snapshot is considered already filtered.
   */
  static fromJSON(s: GameLogSnapshot): GameLog {
    const opts: GameLogOptions =
      s.includeTypes === null
        ? { minVerbosity: s.minVerbosity }
        : { minVerbosity: s.minVerbosity, includeTypes: new Set(s.includeTypes) };
    const log = new GameLog(opts);
    for (const e of s.entries) log.entries.push(e);
    return log;
  }
}

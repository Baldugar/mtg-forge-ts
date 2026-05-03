// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 2 — golden-trace scenario types.
//
// A GoldenScenario is a deterministic, declarative recipe for a game state
// + a sequence of engine actions. The runner builds a Game from the
// `players` block, executes `actions` in order, and dumps the resulting
// event stream to JSON. Future runs replay the same scenario and diff
// against the locked golden file.
//
// Scope intentionally narrow: M2 covers cast/resolve, ETB, activated
// abilities, and statics — the four primitives that exercise the bulk of
// engine behaviour without requiring the full priority/phase loop.
// M3 (Java parity) will extend the scenario format to drive multi-turn
// games via runGame; for now scenarios are single-action recipes.
//
// Why no PhaseHandler.run? The smoke harness already proves the phase
// machine doesn't crash on real cards. Goldens isolate behavioural drift
// in the cast/resolve/ETB/static paths — driving full turns adds noise
// (mulligan/draw/discard events) that swamps the signal we care about.

import type { PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";

/**
 * Top-level scenario spec. Stored alongside its captured trace as
 * `<id>.golden.json` in `__golden__/`.
 */
export interface GoldenScenario {
  /** kebab-case identifier; doubles as the golden filename stem. */
  readonly id: string;
  /** Human-readable summary — surfaced on diff failures. */
  readonly description: string;
  /** Seed for game.rng. Determinism gate. */
  readonly seed: number;
  /** Card source in Forge .txt format, keyed by name. */
  readonly cards: Readonly<Record<string, string>>;
  /** Two-player setup (M2 is 2p only; M3 may extend). */
  readonly players: readonly [ScenarioPlayer, ScenarioPlayer];
  /** Ordered list of actions the runner executes against the built Game. */
  readonly actions: readonly ScenarioAction[];
}

/**
 * Per-seat starting state. Library is optional and seeded only if a
 * scenario explicitly requires it (e.g. Mulldrifter draw target).
 */
export interface ScenarioPlayer {
  readonly life: number;
  readonly hand: readonly string[];
  readonly battlefield: readonly ScenarioPermanent[];
  readonly graveyard?: readonly string[];
  readonly library?: readonly string[];
  /**
   * Optional starting mana pool. Each entry is a Forge mana letter
   * (W/U/B/R/G/C); duplicates accumulate. Useful for cast scenarios so
   * the runner doesn't need to drive mana-ability activation.
   */
  readonly manaPool?: readonly ManaPoolEntry[];
}

export type ManaPoolEntry = "W" | "U" | "B" | "R" | "G" | "C";

/**
 * Battlefield permanents are seeded via moveTo(Battlefield), so ETB
 * triggers fire and statics activate, producing events in the trace.
 * This means a scenario's "starting state" already contains observable
 * setup events — by design, since pre-action ETB fan-out is part of
 * what we lock against drift.
 */
export interface ScenarioPermanent {
  readonly card: string;
  readonly tapped?: boolean;
}

/**
 * Action union driven by the runner's interpreter. M2 defines four kinds:
 *   - "etb": move a card from hand to battlefield via the canonical
 *     moveTo pipeline. Captures ETB triggers + static activation.
 *     Bypasses cast (no cost paid, no SpellCast event).
 *   - "cast": full cast pipeline using the seeded mana pool. Captures
 *     CostPaid + SpellCast. Resolution is *not* automatic — separate
 *     "resolveTopOfStack" action drains the stack.
 *   - "resolveTopOfStack": pop the top stack item and resolve it.
 *     Auto-binds an alternativeZoneDestination=Battlefield for permanent
 *     spells (since the engine doesn't yet auto-set it).
 *   - "activate": activate an activated ability on a permanent (ability
 *     index defaults to 0). Captures the activation events; resolution
 *     is *not* automatic — combine with "resolveTopOfStack".
 */
export type ScenarioAction =
  | {
      readonly kind: "etb";
      readonly cardName: string;
      readonly controller: PlayerSeat;
    }
  | {
      readonly kind: "cast";
      readonly cardName: string;
      readonly castingPlayer: PlayerSeat;
      /** Optional target — bound onto the resolver in resolveTopOfStack. */
      readonly target?: TargetRef;
    }
  | {
      readonly kind: "resolveTopOfStack";
      /** Override stack-item destination. Defaults to GraveyardForSpells / Battlefield for permanents. */
      readonly destination?: "Battlefield" | "Graveyard" | "Exile";
    }
  | {
      readonly kind: "activate";
      readonly sourceCardName: string;
      readonly activatingPlayer: PlayerSeat;
      readonly abilityIndex?: number;
    }
  // M7.0 — multi-turn parity. The phase-driver actions advance the
  // phase handler one or more steps. Each kind drains pending triggers
  // (and resolves the resulting stack) between every step traversal so
  // upkeep / EOT triggers + cleanup-step state-based wipes fan out
  // exactly as they would mid-turn. Java BridgeRunner already supports
  // matching `advancePhase` / `advanceToStep` action handlers
  // (BridgeRunner.java:453); `passTurn` is implemented as a loop of
  // advancePhase calls until `game.turn` increments by 1 (TS-side).
  | {
      readonly kind: "advancePhase";
    }
  | {
      readonly kind: "advanceToStep";
      /**
       * Target step. PhaseStep enum values are PascalCase strings
       * (Untap, Upkeep, …, Cleanup) — same identifiers Forge uses, so
       * the bridge can map them directly via PhaseType.smartValueOf.
       */
      readonly step: PhaseStep;
    }
  | {
      readonly kind: "passTurn";
    };

/**
 * Target reference resolved at action-execution time. M2 supports the
 * minimum needed for the curated scenario set:
 *   - by-name card lookup (first match wins; scenarios should disambiguate).
 *   - by-seat player lookup.
 */
export type TargetRef =
  | { readonly kind: "card"; readonly name: string }
  | { readonly kind: "player"; readonly seat: PlayerSeat };

/**
 * Captured trace shape persisted as JSON. The `events` array is the
 * canonical comparison unit; `finalState` is included for human-friendly
 * sanity-checking on diff failures.
 */
export interface GoldenTrace {
  readonly scenarioId: string;
  readonly seed: number;
  readonly engineVersion: string;
  /** Complete event stream emitted across all actions, in order. */
  readonly events: readonly GoldenEvent[];
  /** Snapshot of player-visible state at the end of the run. */
  readonly finalState: GoldenFinalState;
}

/**
 * Trimmed event shape for the golden file. We deliberately drop the
 * `version` field (always 1 for now — locked elsewhere) and stringify
 * EntityIds + PlayerSeats as numbers so JSON round-trip is stable.
 */
export interface GoldenEvent {
  readonly kind: string;
  readonly turn: number;
  readonly phase: string;
  readonly payload: unknown;
}

export interface GoldenFinalState {
  readonly lifeTotals: readonly [number, number];
  readonly handSizes: readonly [number, number];
  readonly battlefield: readonly GoldenBattlefieldEntry[];
  readonly graveyards: readonly [readonly string[], readonly string[]];
  readonly stackSize: number;
}

export interface GoldenBattlefieldEntry {
  readonly name: string;
  readonly controller: number;
  readonly tapped: boolean;
}

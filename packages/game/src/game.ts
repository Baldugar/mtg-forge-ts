// SPDX-License-Identifier: GPL-3.0-or-later
// Top-level Game object: composes lobby participants into Players, owns the
// shared zones (exile, ante, stack), per-Game mutable flags, and the
// entity-id allocator. Consumers construct with a SeededRng so every
// mutation is deterministic.
//
// SP4 will replace `attachCardDb` with the real CardDb integration.
import type {
  ContinuousEffect,
  EntityId,
  GameEvent,
  GameEventKind,
  LobbyPlayer,
  PhaseStep,
  PlayerSeat,
  Rng,
} from "@mtg-forge-ts/core";
import {
  GameStateIntegrityError,
  PhaseStep as Phase,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "./action/engine-yield.js";
import type { Card } from "./card.js";
import type { GameFlags } from "./game-flags.js";
import { createDefaultFlags } from "./game-flags.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { LayerEngine } from "./layers/layer-engine.js";
import { Player } from "./player.js";
import { ReplacementRegistry } from "./replacements/replacement-registry.js";
import { Stack } from "./stack/stack.js";
import { TargetSystem } from "./target/target-system.js";
import type { TerminalState } from "./terminal-state.js";
import { DelayedTriggerQueue } from "./triggers/delayed-trigger-queue.js";
import { LinkedAbilityTable } from "./triggers/linked-abilities.js";
import { TriggerRegistry } from "./triggers/trigger-registry.js";
import { Ante } from "./zone/zones/ante.js";
import { Exile } from "./zone/zones/exile.js";

// WHY: event kinds that are engine-internal bookkeeping — registry
// telemetry, replacement pipeline intermediates, SBA bookkeeping, cost-
// paid markers. These are emitted for observability but must NOT feed the
// trigger or delayed-trigger queues: if they did, a "when a trigger
// resolves" hook would re-fire the trigger indefinitely, and replacement
// pipeline markers would mint phantom triggers that no card writes.
//
// Canonical events (CardDrawn, DamageDealt, StackItemResolved, etc.) DO
// route to triggers. The allowlist is implicit — if the kind is NOT in
// this deny set, it flows through.
const ENGINE_INTERNAL_EVENT_KINDS: ReadonlySet<GameEventKind> = new Set<GameEventKind>([
  "ReplacementApplied",
  "EventPrevented",
  "TriggerQueued",
  "TriggerResolved",
  "StateBasedActionApplied",
  "StaticAbilityRegistered",
  "StaticAbilityUnregistered",
  "ContinuousEffectRegistered",
  "ContinuousEffectExpired",
  "CostPaid",
  "PhaseStepEnded",
]);

export class Game {
  readonly meta: GameMeta;
  readonly rules: GameRules;
  readonly rng: Rng;
  private entityIdCounter = 0;

  turn = 1;
  phase: PhaseStep = Phase.Untap;
  activePlayer: PlayerSeat = mkPlayerSeat(0);
  priorityPlayer: PlayerSeat | null = null;
  /**
   * Resolved at setup time by a die-roll off `rng`. Null until
   * `setupGame` runs the die-roll step. `firstPlayerSkipsDraw` reads this
   * (not seat 0) to determine whose first-turn Draw is elided.
   * Consumers who want deterministic seat-0 starts can assign this field
   * before invoking setupGame; the generator respects an existing value.
   */
  startingPlayer: PlayerSeat | null = null;

  readonly players: Player[];
  readonly sharedZones: { stack: Stack; exile: Exile; ante: Ante };
  readonly flags: GameFlags;
  // Registry of every live Card in the game, keyed by EntityId. GameAction
  // mutators (tap, addCounter, moveTo, …) look up cards here to update their
  // mutable state. Populated by MatchSetup (Task 45) and by token/emblem
  // factories in SP2; SP1 tests seed it directly.
  readonly cards = new Map<EntityId, Card>();
  /**
   * CR 613 layer-system effect ledger. SP1 reserves the list as an empty
   * mutable array so SP2's layer engine can append/remove without bumping
   * the snapshot schemaVersion again. SP1 emits an empty list on snapshot
   * and restore is a no-op when the list is empty.
   */
  continuousEffects: ContinuousEffect[] = [];
  readonly layerEngine: LayerEngine;
  readonly targetSystem: TargetSystem;
  readonly replacementRegistry: ReplacementRegistry;
  readonly triggerRegistry: TriggerRegistry;
  readonly delayedTriggerQueue: DelayedTriggerQueue;
  readonly linkedAbilities: LinkedAbilityTable;
  terminalState: TerminalState | null = null;

  constructor(opts: { lobbyPlayers: LobbyPlayer[]; rules: GameRules; meta: GameMeta; rng: Rng }) {
    if (opts.lobbyPlayers.length < opts.rules.playerCount.min) {
      throw new GameStateIntegrityError(
        `Game requires at least ${opts.rules.playerCount.min} players, got ${opts.lobbyPlayers.length}`,
      );
    }
    if (opts.lobbyPlayers.length > opts.rules.playerCount.max) {
      throw new GameStateIntegrityError(
        `Game allows at most ${opts.rules.playerCount.max} players, got ${opts.lobbyPlayers.length}`,
      );
    }
    this.rules = opts.rules;
    this.meta = opts.meta;
    this.rng = opts.rng;
    this.players = opts.lobbyPlayers.map(
      (lp, i) =>
        new Player(mkPlayerSeat(i), lp, opts.rules.teamAssignments?.[i] ?? i, opts.rules.startingLife),
    );
    this.sharedZones = {
      stack: new Stack(),
      exile: new Exile(ZoneType.Exile, null),
      ante: new Ante(ZoneType.Ante, null),
    };
    this.layerEngine = new LayerEngine(this);
    // WHY: targetSystem must be constructed AFTER layerEngine — enumerate
    // consults computeCharacteristics for type-gated restrictions.
    this.targetSystem = new TargetSystem(this);
    this.replacementRegistry = new ReplacementRegistry();
    // WHY: trigger + delayed-trigger registries last so they can capture
    // `this` — the trigger registry reads Game.turn / Game.phase /
    // Game.cards at registration time (no forward references). The
    // delayed-trigger queue is stateless over Game, but kept alongside
    // for discoverability.
    this.triggerRegistry = new TriggerRegistry(this);
    this.delayedTriggerQueue = new DelayedTriggerQueue();
    this.linkedAbilities = new LinkedAbilityTable();
    this.flags = createDefaultFlags();
  }

  newEntityId(): EntityId {
    return mkEntityId(this.entityIdCounter++);
  }

  /**
   * Snapshot-restore only. GameSnapshot rehydrates the private entity-id
   * allocator so freshly-minted ids after restore don't collide with ids
   * already baked into the restored card registry. Consumers must not call
   * this outside the snapshot-restore path — it breaks the append-only
   * monotonicity guarantee newEntityId relies on for uniqueness.
   */
  restoreEntityIdCounter(n: number): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`restoreEntityIdCounter: expected non-negative integer, got ${n}`);
    }
    this.entityIdCounter = n;
  }

  getPlayer(seat: PlayerSeat): Player {
    const p = this.players[seat as unknown as number];
    if (!p) throw new GameStateIntegrityError(`No player at seat ${seat}`);
    return p;
  }

  isTerminal(): boolean {
    return this.terminalState !== null;
  }

  attachCardDb(_db: unknown): void {
    throw new Error("Game.attachCardDb: SP4 CardDb integration required");
  }

  /**
   * Canonical single-pipe event emission (SP2 Tasks 20 + 23).
   *
   * Every call funnels a GameEvent to:
   *   1. TriggerRegistry.onEvent     — CR 603 trigger collection
   *   2. DelayedTriggerQueue.onEvent — CR 603.7 delayed trigger matching
   *      (forwards matches back into the TriggerRegistry via
   *      onEventForcedByDelayed; one-shot entries get removed)
   * and returns the EngineYield the caller yields to the driver for
   * replay/log subscribers to observe.
   *
   * Engine-internal kinds (ReplacementApplied, EventPrevented, trigger-
   * pipeline telemetry, SBA bookkeeping, cost-paid, phase-step-ended)
   * are observability-only — they do NOT fire triggers. Routing them
   * would create self-reference loops (a "when a trigger resolves"
   * hook would re-fire itself) or mint phantom triggers.
   *
   * GameAction callers should prefer `yield game.emitEvent(mkEvent(...))`
   * over building `{ kind: "event", event }` directly so this single
   * choke point stays authoritative.
   */
  emitEvent(event: GameEvent): EngineYield {
    if (!ENGINE_INTERNAL_EVENT_KINDS.has(event.kind)) {
      // Order matters: TriggerRegistry first (primary consumer for
      // registered triggers), then DelayedTriggerQueue (its matches
      // funnel back into the same registry's pending via
      // onEventForcedByDelayed). Both are synchronous; neither throws
      // under a well-formed event.
      this.triggerRegistry.onEvent(event);
      this.delayedTriggerQueue.onEvent(event, this.triggerRegistry);
    }
    return { kind: "event", event };
  }
}

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
import { GameAction } from "./action/game-action.js";
import { AuraAbilityGrantLedger } from "./attachment/aura-ability-grant.js";
import type { Card } from "./card.js";
import { CastPipeline } from "./cast/cast-pipeline.js";
import { ContinuousEffectRegistry } from "./continuous/continuous-effect-registry.js";
import { ControlChangeLedger } from "./control-change/control-change-ledger.js";
import type { GameFlags } from "./game-flags.js";
import { createDefaultFlags } from "./game-flags.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { LayerEngine } from "./layers/layer-engine.js";
import { Player } from "./player.js";
import { ReplacementRegistry } from "./replacements/replacement-registry.js";
import { RingGrantLedger } from "./ring/level-grants.js";
import type { RingState } from "./ring/ring-state.js";
import { SbaEngine } from "./sba/sba-engine.js";
import { Stack } from "./stack/stack.js";
import { StaticEffectRegistry } from "./statics/static-effect-registry.js";
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
  readonly staticEffectRegistry: StaticEffectRegistry;
  readonly continuousEffectRegistry: ContinuousEffectRegistry;
  readonly sbaEngine: SbaEngine;
  readonly castPipeline: CastPipeline;
  readonly delayedTriggerQueue: DelayedTriggerQueue;
  readonly linkedAbilities: LinkedAbilityTable;
  // Shared GameAction — the canonical mutator entry point. Subsystems
  // (SbaEngine, combat, resolution) route all state changes through here
  // so the replacement pipeline sees every mutation. Tests may construct
  // their own GameAction too; the shared instance is for engine-internal
  // consumers that don't have their own handle.
  readonly action: GameAction;
  // SP2 Milestone K Task 43 — per-attachment Layer 6 grant bookkeeping.
  // GameAction.attach/unattach drive this; Layer 6 scoping via
  // AbilityChangeEffect.targetCardId does the filtering. See
  // attachment/aura-ability-grant.ts for details.
  readonly auraGrantLedger: AuraAbilityGrantLedger;
  // SP2 Milestone L Task 45 — time-bounded control change bookkeeping.
  // GameAction.changeControl writes entries on opts.until; Game.emitEvent
  // queries expiredOn() to decide which entries to revert.
  readonly controlChangeLedger: ControlChangeLedger;
  // SP2 Milestone L Task 45 — cards whose control change expired on the
  // most recent canonical event. The priority orchestrator drains this
  // list after each event via GameAction.expireControlChanges so the
  // reverting ControlChanged events flow through the main pipeline
  // (triggers see them, replacements can intercept).
  readonly pendingControlReverts: EntityId[] = [];
  /**
   * SP2 Milestone M Task 51 — team-combat (Two-Headed Giant) shared life
   * pool. Populated by the Game constructor when
   * `rules.appliedVariants.includes("TwoHeadedGiant")`; left `null`
   * otherwise so the normal per-player life model is untouched.
   *
   * Shape: teamId → current shared life. Starting life equals
   * `rules.startingLife` for 2HG (two 20-life teams by default; rules
   * that override startingLife flow through unchanged — Forge mirrors
   * this). Damage-routing integration (player damage → team life) is
   * deferred to SP6/formats per master-spec §10.teams; SP2 only
   * establishes the state slot and a `getTeamLifeFor(seat)` helper.
   */
  teamLife: Map<number, number> | null = null;
  /**
   * SP2 Milestone R Task 62 — CR 701.52 per-player Ring state. Keyed by
   * PlayerSeat and kept sparse: players who have never been tempted have
   * no entry (semantically equal to `{ bearer: null, level: 0 }`).
   */
  readonly ringState = new Map<PlayerSeat, RingState>();
  /**
   * SP2 Milestone R Task 63 — Ring level ability-grant ledger. Owns the
   * Layer 6 contributions for each seat's bearer; re-applied on every
   * tempt() so bearer swaps and level-ups stay consistent with
   * computeCharacteristics.
   */
  readonly ringGrantLedger: RingGrantLedger;
  terminalState: TerminalState | null = null;
  /**
   * SP2 Milestone W Task 72 — CR 702.139 companion declaration. Populated
   * by setupGame's pre-mulligan companion step when the seat declares a
   * companion, left as `null` otherwise. Keyed by seat; the value is the
   * EntityId of the declared companion card (which remains in the
   * sideboard slot until its one-time "pay 3 generic" activation puts it
   * into the caster's hand — handled in SP3's priority loop). SP2 scope:
   * record the declaration; defer condition validation and the
   * sideboard-to-hand activation to SP6 (formats).
   */
  readonly companions = new Map<PlayerSeat, EntityId | null>();

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
    // WHY after triggerRegistry: the static registry's layer/replacement
    // contributors (Tasks 26/28) do not depend on trigger state, but
    // keeping ordering monotonic ("downstream registries last") makes
    // the construction order self-documenting.
    this.staticEffectRegistry = new StaticEffectRegistry(this);
    // WHY after staticEffectRegistry: the continuous-effect registry (SP2
    // Milestone H) shares the same layer-dispatch helper and does not
    // depend on any static-registry state. Construction order is kept
    // monotonic (downstream registries last) for discoverability.
    this.continuousEffectRegistry = new ContinuousEffectRegistry(this);
    // WHY after staticEffectRegistry: SBA collectors may eventually query
    // static "you don't lose the game" or "indestructible" rule-changers
    // (future work); keeping construction monotonic puts consumers last.
    this.sbaEngine = new SbaEngine(this);
    // WHY after sbaEngine, before GameAction: CastPipeline is a small
    // subsystem that only reads Game.cards + Game.targetSystem; it doesn't
    // depend on GameAction but GameAction doesn't depend on it either.
    // Placing it here keeps "downstream consumers last" monotonic.
    this.castPipeline = new CastPipeline(this);
    // WHY last: GameAction takes `this` at construction time but doesn't
    // read any registry state until called. Constructing it here ensures
    // every registry above is available before any mutation routes through.
    this.action = new GameAction(this);
    // Ledger of per-attachment Layer 6 grant records. Stateless w.r.t
    // other registries — just a keyed bookkeeping surface consumed by
    // GameAction.attach/unattach hooks.
    this.auraGrantLedger = new AuraAbilityGrantLedger();
    // Task 45 — time-bounded control change ledger. Written by
    // GameAction.changeControl when opts.until is present; read by
    // Game.emitEvent on each canonical event to detect expirations.
    this.controlChangeLedger = new ControlChangeLedger();
    this.delayedTriggerQueue = new DelayedTriggerQueue();
    this.linkedAbilities = new LinkedAbilityTable();
    // Task 62 — Ring-grant ledger is stateless over other registries; a
    // fresh per-Game instance is all we need. tempt() populates it on
    // first temptation.
    this.ringGrantLedger = new RingGrantLedger();
    this.flags = createDefaultFlags();
    // Task 51 — 2HG team-life pool. We populate per-team starting life only
    // when the variant is applied. Each distinct teamId seen in players
    // gets `startingLife` (2HG default is 30 per team, but we respect
    // rules.startingLife so formats can override). Full damage-routing
    // integration (player damage → shared pool) is deferred to SP6/formats.
    if (opts.rules.appliedVariants.includes("TwoHeadedGiant")) {
      const pool = new Map<number, number>();
      for (const p of this.players) {
        if (!pool.has(p.teamId)) pool.set(p.teamId, opts.rules.startingLife);
      }
      this.teamLife = pool;
    }
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

  /**
   * Task 51 — return the team-life pool value for the team containing
   * `seat`, or `null` when team-combat (Two-Headed Giant) is NOT in
   * force. Callers in SP6/format-specific damage-routing will consult
   * this to decide whether a player's life change should instead mutate
   * the shared pool.
   */
  getTeamLifeFor(seat: PlayerSeat): number | null {
    if (!this.teamLife) return null;
    const player = this.getPlayer(seat);
    return this.teamLife.get(player.teamId) ?? null;
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
      // SP2 Milestone H (Task 33) — continuous-effect duration evaluator.
      // Routed on the canonical event feed so TurnEnded / CombatEnded /
      // PhaseStepEnded / CardChangedZone all get a chance to expire time-
      // limited effects. Expirations queue into the registry's drain
      // buffer; the priority orchestrator (Milestone J) yields one
      // ContinuousEffectExpired event per drained entry.
      this.continuousEffectRegistry.onEvent(event);
      // SP2 Milestone L Task 45 — time-bounded control changes. The
      // ledger identifies which cards need their control reverted; we
      // queue the ids here and GameAction.expireControlChanges drains
      // them (pumped by the priority orchestrator after draining the
      // trigger queue). Inline reversion would be tempting but would
      // recurse into emitEvent inside a non-generator method — the
      // resulting ControlChanged events would fire triggers outside
      // the orchestrator's ordering pass.
      const expired = this.controlChangeLedger.expiredOn(event);
      for (const id of expired) {
        if (!this.pendingControlReverts.includes(id)) this.pendingControlReverts.push(id);
      }
    }
    return { kind: "event", event };
  }
}

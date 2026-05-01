// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 2 — golden-trace runner.
//
// The runner takes a GoldenScenario, builds a deterministic Game, applies
// the seeded state (battlefield permanents via the canonical moveTo
// pipeline so ETB triggers fire), executes each scripted action, and
// returns a GoldenTrace.
//
// The runner has three contracts:
//   1. Determinism — given the same scenario + seed, the produced trace is
//      byte-identical run-to-run (verified by the `runs twice identically`
//      meta-test in golden.test.ts).
//   2. No silent target-fabrication — if a card requires a target and the
//      scenario didn't supply one, the action throws rather than picking
//      a default. Goldens must encode all decisions.
//   3. Update mode — when env `UPDATE_GOLDENS=1` is set, the test layer
//      calls `writeGolden`. Otherwise it calls `compareTrace` and the test
//      fails on first divergence.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCard } from "@mtg-forge-ts/cards";
import type {
  CardDefinition,
  DecisionRequest,
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  isPermanentType,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { SpellAbility, type SpellAbilityTargetRef } from "../../src/ability/spell-ability.js";
import { GameAction } from "../../src/action/game-action.js";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import { RandomLegalController } from "../../src/controller/random-legal-controller.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem, StackItemResolver } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects, cost parts, svar selectors, trigger handlers.
// Order does not matter — each uses idempotent registration.
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";
import "../../src/svar/selectors/number.js";
import "../../src/trigger/handlers/index.js";
import "../../src/replacement/handlers/index.js";

import type {
  GoldenBattlefieldEntry,
  GoldenEvent,
  GoldenFinalState,
  GoldenScenario,
  GoldenTrace,
  ManaPoolEntry,
  ScenarioAction,
  ScenarioPermanent,
  TargetRef,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ENGINE_VERSION = "ts-m2-0.1.0" as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "__golden__");

const RULES: GameRules = {
  formatId: "casual",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};

const META: GameMeta = {
  engineVersion: ENGINE_VERSION,
  forgeSha: "golden",
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2026-03-17",
  seed: "0xGOLDEN",
};

const ALICE: LobbyPlayer = { id: "alice", name: "Alice", controllerKind: "human" };
const BOB: LobbyPlayer = { id: "bob", name: "Bob", controllerKind: "ai" };

const COLOR_MAP: Readonly<Record<ManaPoolEntry, Color | "C">> = {
  W: Color.White,
  U: Color.Blue,
  B: Color.Black,
  R: Color.Red,
  G: Color.Green,
  C: "C",
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Runner options. M2.5: `drainStack` (default true) drives the priority
 * loop's stack-drain semantics after each scripted action — resolving
 * stack items, draining triggered abilities into the stack, applying
 * SBAs — until the stack is empty and no more triggers are pending.
 *
 * Symmetric with Bridge V2's full Forge resolution: re-captured goldens
 * include the post-resolution events Forge already surfaces (triggered-
 * ability `SpellCast`, `StackItemResolved`, post-resolve `CardChangedZone`
 * for spells → graveyard, `LifeTotalChanged` from triggered life-changes).
 *
 * Set `drainStack: false` for legacy single-action capture (kept for
 * regression isolation when debugging a specific scripted action without
 * resolution noise).
 */
export interface RunOptions {
  readonly drainStack?: boolean;
}

/**
 * Run a scenario and return its captured trace. Pure: caller decides
 * whether to write or compare.
 */
export function runScenario(scenario: GoldenScenario, opts: RunOptions = {}): GoldenTrace {
  const ctx = buildContext(scenario);
  const events: GameEvent[] = [];
  const drainStack = opts.drainStack !== false;

  // Capture pre-action setup events (statics ETB, etc.) — these are part
  // of the locked trace because regression in ETB ordering is exactly
  // what M2 catches.
  events.push(...ctx.pendingEvents);
  ctx.pendingEvents.length = 0;

  for (let i = 0; i < scenario.actions.length; i++) {
    const action = scenario.actions[i];
    if (action === undefined) continue;
    runAction(ctx, action);
    if (drainStack) {
      // Symmetric with Bridge V2: resolve everything that's left on the
      // stack (drain triggered abilities + resolve any unresolved spell)
      // — UNLESS the scenario explicitly drives the next step via
      // `resolveTopOfStack`. In that case we only drain triggers and
      // skip the floor item so the next action finds the same stack
      // shape it expects (preserves backwards-compat with cast +
      // resolveTopOfStack scenarios like lightning-bolt-target-*).
      const next = scenario.actions[i + 1];
      const nextIsScriptedResolve = next !== undefined && next.kind === "resolveTopOfStack";
      runStackUntilEmpty(ctx, { resolveFloor: !nextIsScriptedResolve });
    }
    events.push(...ctx.pendingEvents);
    ctx.pendingEvents.length = 0;
  }

  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    engineVersion: ENGINE_VERSION,
    events: events.map(stripEvent),
    finalState: snapshotFinalState(ctx),
  };
}

/** Where on disk a given scenario's golden lives. */
export function goldenPath(scenarioId: string): string {
  return join(GOLDEN_DIR, `${scenarioId}.golden.json`);
}

/**
 * Persist the trace as the canonical golden. Used by tests under
 * `UPDATE_GOLDENS=1` and by manual capture scripts.
 */
export function writeGolden(scenarioId: string, trace: GoldenTrace): void {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  writeFileSync(goldenPath(scenarioId), serialise(trace), "utf8");
}

/** Read a golden trace from disk; returns null if missing. */
export function readGolden(scenarioId: string): GoldenTrace | null {
  const p = goldenPath(scenarioId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as GoldenTrace;
}

/**
 * Diff two traces, returning a structured first-divergence record or
 * `null` when they match. Diffing is order-sensitive; we only compare
 * `events` + `finalState` (engineVersion intentionally excluded so a
 * version bump alone does not invalidate the corpus).
 */
export interface TraceDivergence {
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly context: string;
}

export function compareTrace(expected: GoldenTrace, actual: GoldenTrace): TraceDivergence | null {
  // Event-array length first — short-circuit common case.
  if (expected.events.length !== actual.events.length) {
    return {
      path: "events.length",
      expected: expected.events.length,
      actual: actual.events.length,
      context: `event count differs — expected ${expected.events.length}, got ${actual.events.length}`,
    };
  }

  for (let i = 0; i < expected.events.length; i++) {
    const e = expected.events[i];
    const a = actual.events[i];
    // Index-bounds satisfied by length-check above; the Generic !== check
    // is for the type-narrowing pass.
    if (!e || !a) {
      return {
        path: `events[${i}]`,
        expected: e ?? null,
        actual: a ?? null,
        context: "internal: missing event after length-check",
      };
    }
    const div = diffEvent(e, a, i);
    if (div) return div;
  }

  // Final state — coarser comparison; diff individual fields for clarity.
  if (JSON.stringify(expected.finalState) !== JSON.stringify(actual.finalState)) {
    return {
      path: "finalState",
      expected: expected.finalState,
      actual: actual.finalState,
      context: "finalState mismatch (full snapshot diff)",
    };
  }
  return null;
}

// ── Context construction ─────────────────────────────────────────────────────

interface RunnerContext {
  readonly game: Game;
  readonly action: GameAction;
  readonly seats: readonly [PlayerSeat, PlayerSeat];
  readonly cardDefs: ReadonlyMap<string, CardDefinition>;
  /** Track entity ids per name so target lookup is deterministic. */
  readonly cardsByName: Map<string, EntityId[]>;
  /**
   * Pending events buffer. The runner subscribes to game.events.subscribe
   * (via emitEvent override) into this array. Drained between actions so
   * each action's events are sliced into the trace contiguously.
   */
  readonly pendingEvents: GameEvent[];
}

function buildContext(scenario: GoldenScenario): RunnerContext {
  const game = new Game({
    lobbyPlayers: [ALICE, BOB],
    rules: RULES,
    meta: META,
    rng: new SeededRng(BigInt(scenario.seed)),
  });

  // Events are pulled from generator yields (no event bus on Game). Each
  // drainGenerator call appends to this buffer; runScenario slices it
  // into the trace between actions.
  const pendingEvents: GameEvent[] = [];

  // Per-player zones — the smoke harness already proves this seeding
  // works at scale, reuse the pattern.
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }

  // Apply life totals before placing any permanents (statics may depend
  // on life). Index access is guarded by the readonly tuple type but TS
  // still demands the explicit narrow with exactOptionalPropertyTypes.
  const p0 = game.players[0];
  const p1 = game.players[1];
  if (!p0 || !p1) throw new Error("golden runner: Game must have 2 players");
  p0.life = scenario.players[0].life;
  p1.life = scenario.players[1].life;

  // Mana pools — apply early so a ScenarioPlayer with manaPool can be
  // referenced by a "cast" action.
  for (let i = 0; i < 2; i++) {
    const seat = mkPlayerSeat(i);
    const pool = new ManaPool();
    const entries = scenario.players[i]?.manaPool ?? [];
    for (const e of entries) {
      const c = COLOR_MAP[e];
      pool.add(c === "C" ? ManaProduced.colorless() : ManaProduced.colored(c));
    }
    game.getPlayer(seat).manaPool = pool;
  }

  // Parse card source (one shared definition per name). PaperCards are
  // minted per scenario instance because EntityId is unique per Card.
  const cardDefs = new Map<string, CardDefinition>();
  for (const [name, source] of Object.entries(scenario.cards)) {
    cardDefs.set(name, parseCard(source, `${scenario.id}/${name}.txt`));
  }

  const cardsByName = new Map<string, EntityId[]>();
  const seats: readonly [PlayerSeat, PlayerSeat] = [mkPlayerSeat(0), mkPlayerSeat(1)];

  const ctx: RunnerContext = {
    game,
    action: new GameAction(game),
    seats,
    cardDefs,
    cardsByName,
    pendingEvents,
  };

  // Seed players' zones in deterministic order: library → graveyard → hand
  // → battlefield. Battlefield last because moveTo there fires triggers
  // that may inspect other zones.
  for (let i = 0; i < 2; i++) {
    // PlayerSeat is a branded number; seat 0 is falsy in JS so `!seat`
    // would skip seat 0. Use explicit undefined-check.
    const seat = seats[i];
    const seatBlock = scenario.players[i];
    if (seat === undefined || seatBlock === undefined) continue;

    for (const name of seatBlock.library ?? []) {
      mintCardInZone(ctx, name, seat, ZoneType.Library);
    }
    for (const name of seatBlock.graveyard ?? []) {
      mintCardInZone(ctx, name, seat, ZoneType.Graveyard);
    }
    for (const name of seatBlock.hand) {
      mintCardInZone(ctx, name, seat, ZoneType.Hand);
    }
    for (const perm of seatBlock.battlefield) {
      seedPermanent(ctx, perm, seat);
    }
  }

  return ctx;
}

function seedPermanent(ctx: RunnerContext, perm: ScenarioPermanent, seat: PlayerSeat): void {
  // Mint into Hand first, then drive moveTo(Battlefield) so the canonical
  // ETB pipeline runs (replacement loop, layer-epoch bump, trigger queue).
  const id = mintCardInZone(ctx, perm.card, seat, ZoneType.Hand);
  driveMoveTo(ctx, id, ZoneType.Battlefield);
  if (perm.tapped === true) {
    const card = ctx.game.cards.get(id);
    if (card) card.tapped = true;
  }
}

function mintCardInZone(ctx: RunnerContext, name: string, seat: PlayerSeat, zone: ZoneType): EntityId {
  const def = ctx.cardDefs.get(name);
  if (!def) throw new Error(`golden runner: card '${name}' not in scenario.cards`);
  const id = ctx.game.newEntityId();
  const paper: PaperCard = {
    name: def.name,
    edition: "GLD",
    collectorNumber: String(id as unknown as number).padStart(4, "0"),
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
  const card = new Card(id, paper, seat, seat, zone);
  ctx.game.cards.set(id, card);
  // Activate ability/trigger/replacement/keyword/static binding. The
  // canonical first-time-on-card sequence (matches smoke harness order).
  card.activateAbilitiesFromDefinition();
  card.activateTriggersFromDefinition(ctx.game);
  card.activateReplacementsFromDefinition(ctx.game);
  card.activateKeywordsFromDefinition(ctx.game);
  card.activateStaticsFromDefinition(ctx.game);

  const target = ctx.game.getPlayer(seat).zones.get(zone);
  if (!target) throw new Error(`golden runner: missing ${zone} zone for seat`);
  target.add(id);

  const list = ctx.cardsByName.get(name) ?? [];
  list.push(id);
  ctx.cardsByName.set(name, list);
  return id;
}

// ── Action execution ─────────────────────────────────────────────────────────

function runAction(ctx: RunnerContext, action: ScenarioAction): void {
  switch (action.kind) {
    case "etb":
      runEtb(ctx, action);
      return;
    case "cast":
      runCast(ctx, action);
      return;
    case "resolveTopOfStack":
      runResolveTop(ctx, action);
      return;
    case "activate":
      runActivate(ctx, action);
      return;
  }
}

function runEtb(
  ctx: RunnerContext,
  action: { readonly cardName: string; readonly controller: PlayerSeat },
): void {
  const id = lookupCardId(ctx, action.cardName, ZoneType.Hand, action.controller);
  driveMoveTo(ctx, id, ZoneType.Battlefield);
}

function runCast(
  ctx: RunnerContext,
  action: {
    readonly cardName: string;
    readonly castingPlayer: PlayerSeat;
    readonly target?: TargetRef;
  },
): void {
  const id = lookupCardId(ctx, action.cardName, ZoneType.Hand, action.castingPlayer);
  const proposal: CastProposal = {
    castingPlayer: action.castingPlayer,
    sourceCardId: id,
    originZone: ZoneType.Hand,
    asSpecialAction: false,
  };
  const gen = ctx.game.castPipeline.run(proposal) as Generator<
    { kind: string; event?: GameEvent; request?: { kind?: string } },
    StackItem | null,
    unknown
  >;
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 1000) throw new Error("golden runner: runaway cast generator");
    const y = step.value;
    if (y.kind === "event" && y.event) {
      ctx.pendingEvents.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.kind === "decision") {
      const req = y.request as { kind?: string };
      if (req.kind === "activateManaAbilities") {
        step = gen.next({ kind: "activateManaAbilities", done: true });
        continue;
      }
      if (req.kind === "chooseCastTargets") {
        // The cast pipeline expects TargetRef objects, not raw EntityIds.
        // Build them from the scenario's TargetRef.
        const targetRefs = action.target ? [makeTargetRef(ctx, action.target)] : [];
        step = gen.next({ kind: "chooseCastTargets", targets: targetRefs as unknown[] });
        continue;
      }
      if (req.kind === "chooseMode") {
        step = gen.next({ kind: "chooseMode", chosenIndices: [0] });
        continue;
      }
      throw new Error(`golden runner: unhandled cast decision kind '${String(req.kind)}'`);
    }
    step = gen.next();
  }
  const stackItem = step.value as StackItem | null;
  if (stackItem === null) {
    // Inspect the events buffer for a CastAbort / CostPaymentFailed event
    // payload to surface the underlying reason rather than a generic null.
    const aborts = ctx.pendingEvents
      .filter((e) => e.kind === "CastAborted" || e.kind.includes("Failed") || e.kind === "CardChangedZone")
      .map((e) => `${e.kind}:${JSON.stringify(e.payload)}`);
    throw new Error(
      `golden runner: cast '${action.cardName}' aborted (returned null). Events seen: [${aborts.join(", ")}]`,
    );
  }

  // If a target was supplied and the cast pipeline didn't already bind
  // it (only happens when the PaperCard has no targetRestriction —
  // chooseCastTargets is the canonical bind path otherwise), patch a
  // target-bound resolver in.
  //
  // M4.5 — only patch when stackItem has no bound targets. Patching an
  // already-bound stackItem corrupts player targets in scenarios with
  // multiple cards in hand: `resolveTarget` returns `seat` as a raw
  // EntityId, which collides with cardIds when the seat number happens
  // to match a card's id. The DealDamage effect then misclassifies the
  // target as a creature. Trusting the pipeline's binding fixes this
  // (lightning-bolt-target-player still works because that path already
  // binds via chooseCastTargets too).
  const pipelineBoundTargets =
    stackItem.targets !== null &&
    Array.isArray(stackItem.targets) &&
    (stackItem.targets as readonly unknown[]).length > 0;
  if (action.target && !pipelineBoundTargets) {
    const targetId = resolveTarget(ctx, action.target);
    const card = ctx.game.cards.get(id);
    const saTemplate = card?.spellAbilities[0];
    if (saTemplate) {
      // M5 — preserve target-kind discriminator for effects that route
      // by recipient flavour (DealDamage etc).
      const targetRef = action.target;
      const targetRefsBound: readonly SpellAbilityTargetRef[] =
        targetRef.kind === "card"
          ? [{ kind: "card", id: targetId } as const]
          : [{ kind: "player", seat: targetRef.seat } as const];
      const bound = new SpellAbility(
        saTemplate.ast,
        saTemplate.sourceCardId,
        saTemplate.controllerSeat,
        saTemplate.svars,
        [targetId],
        undefined,
        undefined,
        undefined,
        targetRefsBound,
      );
      const patched: StackItem = { ...stackItem, resolver: bound.makeResolver() };
      ctx.game.sharedZones.stack.pop();
      ctx.game.sharedZones.stack.push(patched);
    }
  }
}

function runResolveTop(
  ctx: RunnerContext,
  action: { readonly destination?: "Battlefield" | "Graveyard" | "Exile" },
): void {
  const top = ctx.game.sharedZones.stack.top();
  if (!top) throw new Error("golden runner: resolveTopOfStack on empty stack");

  // Determine effective destination. Permanent spells need an explicit
  // alternativeZoneDestination=Battlefield (engine doesn't auto-set it
  // for PaperCard-driven casts as of M2; see mulldrifter test note).
  let dest: ZoneType | undefined = top.provenance.alternativeZoneDestination;
  if (action.destination) {
    dest = (
      { Battlefield: ZoneType.Battlefield, Graveyard: ZoneType.Graveyard, Exile: ZoneType.Exile } as const
    )[action.destination];
  } else if (!dest) {
    // Auto-detect: if the source card is a permanent, route to Battlefield;
    // otherwise the resolve flow handles graveyard placement for spells.
    const sourceCard = ctx.game.cards.get(top.sourceCardId);
    const def = sourceCard?.paperCard.definition;
    if (def) {
      const types = def.types.types;
      if (types.some((t) => isPermanentType(t))) {
        dest = ZoneType.Battlefield;
      }
    }
  }

  let patched: StackItem = top;
  if (dest !== undefined && dest !== top.provenance.alternativeZoneDestination) {
    patched = {
      ...top,
      provenance: { ...top.provenance, alternativeZoneDestination: dest },
    };
    ctx.game.sharedZones.stack.pop();
    ctx.game.sharedZones.stack.push(patched);
  }

  const gen = resolveStackItem(ctx.game, patched) as Generator<
    { kind: string; event?: GameEvent; request?: { kind?: string; replacementIds?: number[] } },
    void,
    unknown
  >;
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 5000) throw new Error("golden runner: runaway resolve generator");
    const y = step.value;
    if (y.kind === "event" && y.event) {
      ctx.pendingEvents.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
      continue;
    }
    step = gen.next();
  }
}

function runActivate(
  ctx: RunnerContext,
  action: {
    readonly sourceCardName: string;
    readonly activatingPlayer: PlayerSeat;
    readonly abilityIndex?: number;
  },
): void {
  const id = lookupCardId(ctx, action.sourceCardName, ZoneType.Battlefield, action.activatingPlayer);
  const idx = action.abilityIndex ?? 0;
  const gen = ctx.action.activateAbility(id, idx, action.activatingPlayer) as Generator<
    { kind: string; event?: GameEvent; request?: { kind?: string; replacementIds?: number[] } },
    unknown,
    unknown
  >;
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 1000) throw new Error("golden runner: runaway activate generator");
    const y = step.value;
    if (y.kind === "event" && y.event) {
      ctx.pendingEvents.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
      continue;
    }
    step = gen.next();
  }
}

// ── Stack-drain (M2.5) ───────────────────────────────────────────────────────

// WHY MAX_DRAIN_ITERATIONS: every iteration must reduce one of {stack
// size, pending-trigger count}. Forge's deepest in-corpus chain is on
// the order of a few dozen; 200 is generous and any breach is an engine
// bug (self-sustaining trigger, runaway cascade), not a game-legal state.
const MAX_DRAIN_ITERATIONS = 200;

/**
 * Drain the priority loop until no triggers are pending AND no stack
 * items above the scenario's "floor" remain. Each iteration:
 *   1. Drain pending triggers from the registry → push as triggeredAbility
 *      stack items (APNAP order via simple sort by sourceControllerAtFire,
 *      active player first; identity-order within group is acceptable for
 *      the M2 cohort which never has >1 simultaneous trigger per player).
 *   2. Resolve any stack item ABOVE the floor (so we never touch a spell /
 *      activated ability the scenario placed and is about to drive itself
 *      via `resolveTopOfStack`). The resolver's generator drives effect
 *      events + StackItemResolved. RandomLegalController answers any
 *      decisions (target picks, mode picks, …) — same pattern as
 *      Subgame Wave 116.
 *   3. Run an SBA sweep so post-resolve state-based actions (creature
 *      death from damage, etc.) get a chance to fire before the next
 *      trigger drain.
 *
 * `floor` is the stack size at entry: existing items belong to the
 * scenario, anything pushed by the drain (triggered abilities) is fair
 * game. This preserves backwards-compat with scenarios that mix `cast`
 * and explicit `resolveTopOfStack` actions.
 *
 * Hard cap at 200 iterations to prevent infinite loops.
 */
interface DrainOptions {
  /**
   * When true (default), the floor (pre-drain stack contents) is also
   * resolved — symmetric with Bridge V2's full drain. When false, the
   * scenario's pre-existing items are left intact so a follow-up
   * scripted `resolveTopOfStack` action can drive them.
   */
  readonly resolveFloor?: boolean;
}

function runStackUntilEmpty(ctx: RunnerContext, opts: DrainOptions = {}): void {
  // Bind a controller once; the RNG is the Game's own SeededRng so
  // determinism is preserved across re-captures.
  const controller = new RandomLegalController(ctx.game.rng);
  const resolveFloor = opts.resolveFloor !== false;
  const floor = resolveFloor ? 0 : ctx.game.sharedZones.stack.size;

  for (let iter = 0; iter < MAX_DRAIN_ITERATIONS; iter++) {
    let didSomething = false;

    // (1) Drain triggers → push triggered-ability stack items.
    const pending = ctx.game.triggerRegistry.drain();
    if (pending.length > 0) {
      const ordered = orderTriggersApnap(pending, ctx.game.activePlayer, [ctx.seats[0], ctx.seats[1]]);
      for (const pt of ordered) {
        const trigger = ctx.game.triggerRegistry.getTrigger(pt.triggerId);
        const triggerResolver =
          (trigger as { readonly resolver?: StackItemResolver | null } | undefined)?.resolver ?? null;
        const stackItem: StackItem = {
          id: ctx.game.newEntityId(),
          sourceCardId: pt.sourceCardId,
          controllerSeat: pt.sourceControllerAtFire,
          kind: "triggeredAbility",
          isCast: false,
          targets: null,
          modes: [],
          xValue: null,
          costPaid: null,
          provenance: {
            originZone:
              pt.lki?.zone ?? ctx.game.cards.get(pt.sourceCardId)?.zone ?? ctx.game.sharedZones.stack.type,
            altCostUsed: null,
            additionalCostsPaid: [],
          },
          triggerId: pt.triggerId,
          lki: pt.lki,
          event: pt.event,
          resolver: triggerResolver,
        };
        ctx.game.sharedZones.stack.push(stackItem);
        // Bridge V2 parity — Forge fires `GameEventSpellAbilityCast` when
        // a triggered ability goes on the stack (one bucket for spells +
        // activated + triggered). The cross-side alias map treats TS
        // `AbilityActivated` ≡ Java `SpellCast`, so we emit the same
        // kind here as `game.action.activateAbility` does for activated
        // abilities. Without this, the parity harness sees Forge's
        // SpellCast for the trigger as TS-shallow.
        // The core AbilityActivated event-shape carries
        // `abilityKind: "activated" | "manaAbility"` only; triggered
        // abilities don't have their own kind here. We tag as
        // "activated" because the parity classifier only consults
        // event-kind ("AbilityActivated" ≡ Java `SpellCast`) — the
        // triggered/activated distinction never escapes the runner.
        ctx.pendingEvents.push(
          mkEvent("AbilityActivated", ctx.game.turn, ctx.game.phase, {
            stackItemId: stackItem.id,
            sourceCardId: pt.sourceCardId,
            controllerSeat: pt.sourceControllerAtFire,
            abilityKind: "activated",
          }),
        );
      }
      didSomething = true;
    }

    // (2) Resolve top of stack only if it's ABOVE the floor — i.e. it
    // was pushed by THIS drain (triggered ability), not by the scenario's
    // pre-drain `cast` action that the scenario will resolve explicitly.
    if (ctx.game.sharedZones.stack.size > floor) {
      const top = ctx.game.sharedZones.stack.top();
      if (top) {
        // CR 605.3a — mana abilities don't use the stack. Forge bypasses
        // the stack entirely (the ManaProduced events fire and that's it).
        // Our engine's `activateAbility` still pushes them to the stack
        // for uniformity, but the parity-side bridge V2 doesn't see a
        // post-resolution `StackItemResolved`. Pop+resolve a mana ability
        // here would emit `StackItemResolved` that Forge never fires.
        // Detection: source card's spell ability at the resolver's
        // handler-key is "Mana".
        if (isManaAbilityStackItem(ctx, top)) {
          // Pop without resolving — drop the synthetic stack slot quietly.
          // No `StackItemResolved` emission so the trace stays symmetric
          // with Forge's mana-ability-bypasses-stack semantics.
          ctx.game.sharedZones.stack.pop();
        } else {
          driveResolveStackItem(ctx, top, controller);
        }
        didSomething = true;
      }
    }

    // (3) Apply SBAs. Post-resolve a creature may have lethal damage
    // (Lightning Bolt → 3 damage to a 2-toughness creature → SBA destroys
    // it → DiesTrigger fires next iteration). The driver yields zero or
    // more SBA event-batches; we relay each event into the trace.
    const sbaGen = ctx.game.sbaEngine.sweep() as Generator<
      { kind: string; event?: GameEvent; request?: DecisionRequest },
      readonly (readonly unknown[])[],
      DecisionResponse
    >;
    let sbaStep = sbaGen.next();
    let sbaSafety = 0;
    while (!sbaStep.done) {
      sbaSafety++;
      if (sbaSafety > 5000) throw new Error("golden runner: runaway SBA generator");
      const y = sbaStep.value;
      if (y.kind === "event" && y.event) {
        ctx.pendingEvents.push(y.event);
        sbaStep = sbaGen.next();
        continue;
      }
      if (y.kind === "decision" && y.request) {
        const resp = controller.decide(y.request);
        sbaStep = sbaGen.next(resp);
        continue;
      }
      sbaStep = sbaGen.next();
    }
    if ((sbaStep.value as readonly unknown[]).length > 0) didSomething = true;

    if (!didSomething) return;
    if (iter === MAX_DRAIN_ITERATIONS - 1) {
      throw new Error(
        `golden runner: runStackUntilEmpty exceeded ${MAX_DRAIN_ITERATIONS} iterations — likely engine bug or scripted scenario depth`,
      );
    }
  }
}

/**
 * CR 605.3a — heuristic for "stack item produces mana, doesn't go on the
 * stack in Forge". Looks for an `activatedAbility` whose source card's
 * matching SpellAbility has `handlerKey === "Mana"`. Conservative —
 * non-mana activated abilities (firebreathing, etc.) return false and
 * resolve normally.
 */
function isManaAbilityStackItem(ctx: RunnerContext, item: StackItem): boolean {
  if (item.kind !== "activatedAbility") return false;
  const card = ctx.game.cards.get(item.sourceCardId);
  if (!card) return false;
  // Any SpellAbility on the card with handlerKey "Mana" → treat as mana
  // ability. This matches Forge's per-ability stack-bypass semantics
  // (CR 605.1a) — if any ability would qualify, the activation that
  // produced this stack item is the mana one.
  return card.spellAbilities.some((sa) => (sa as { handlerKey?: string }).handlerKey === "Mana");
}

/**
 * Lightweight APNAP ordering for the trigger-drain. CR 603.3b: active
 * player's triggers first, then non-active in turn-order; within a
 * player's group the player orders their triggers (identity here — the
 * M2 cohort never has >1 simultaneous trigger per player, and RandomLegal
 * for `orderTriggers` returns identity-order anyway, so we skip the
 * decision yield to keep the runner deterministic on registry-insertion
 * order).
 *
 * Returns triggers in stack-PUSH order (later pushed → resolves first per
 * LIFO). That matches what the priority orchestrator does.
 */
function orderTriggersApnap<T extends { readonly sourceControllerAtFire: PlayerSeat }>(
  pending: readonly T[],
  activeSeat: PlayerSeat,
  allSeats: readonly PlayerSeat[],
): readonly T[] {
  if (pending.length <= 1) return pending;
  const order = new Map<PlayerSeat, number>();
  // Active player first (rank 0), then non-active in seat-order rotated.
  const idx = allSeats.indexOf(activeSeat);
  const rotated = idx < 0 ? allSeats : [...allSeats.slice(idx), ...allSeats.slice(0, idx)];
  for (let i = 0; i < rotated.length; i++) {
    const s = rotated[i];
    if (s !== undefined) order.set(s, i);
  }
  // Stable sort with rank; tied entries keep registry-insertion order.
  // The result is APNAP-flat; reverse for stack-push so AP triggers
  // resolve first (top of LIFO).
  const apnapFlat = [...pending].sort((a, b) => {
    const ra = order.get(a.sourceControllerAtFire) ?? Number.MAX_SAFE_INTEGER;
    const rb = order.get(b.sourceControllerAtFire) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
  return apnapFlat.slice().reverse();
}

/**
 * Drive resolveStackItem on the given top item. Forwards events to
 * pendingEvents and answers any decision via the controller.
 */
function driveResolveStackItem(ctx: RunnerContext, top: StackItem, controller: RandomLegalController): void {
  // For permanent SPELL items with no alternativeZoneDestination, default
  // to Battlefield (matches runResolveTop's auto-detect for scripted
  // resolveTopOfStack). Triggered/activated abilities resolve in place.
  let patched: StackItem = top;
  if (top.kind === "spell" && top.provenance.alternativeZoneDestination === undefined) {
    const sourceCard = ctx.game.cards.get(top.sourceCardId);
    const def = sourceCard?.paperCard.definition;
    if (def?.types.types.some((t) => isPermanentType(t))) {
      patched = {
        ...top,
        provenance: { ...top.provenance, alternativeZoneDestination: ZoneType.Battlefield },
      };
      ctx.game.sharedZones.stack.pop();
      ctx.game.sharedZones.stack.push(patched);
    }
  }

  const gen = resolveStackItem(ctx.game, patched) as Generator<
    { kind: string; event?: GameEvent; request?: DecisionRequest },
    void,
    DecisionResponse | { order?: number[] }
  >;
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 5000) throw new Error("golden runner: runaway resolve generator (drain)");
    const y = step.value;
    if (y.kind === "event" && y.event) {
      ctx.pendingEvents.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.kind === "decision" && y.request) {
      // Special-case orderReplacements (resolveStackItem yields this with
      // a typed `replacementIds` field that isn't a full DecisionRequest).
      const req = y.request as unknown as { kind?: string; replacementIds?: number[] };
      if (req.kind === "orderReplacements") {
        step = gen.next({ order: [...(req.replacementIds ?? [])] } as unknown as DecisionResponse);
        continue;
      }
      const resp = controller.decide(y.request);
      step = gen.next(resp);
      continue;
    }
    step = gen.next();
  }
}

// ── moveTo helper ────────────────────────────────────────────────────────────

function driveMoveTo(ctx: RunnerContext, cardId: EntityId, toZone: ZoneType): void {
  const gen = ctx.action.moveTo(cardId, toZone) as Generator<
    { kind: string; event?: GameEvent; request?: { kind?: string; replacementIds?: number[] } },
    void,
    unknown
  >;
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 5000) throw new Error("golden runner: runaway moveTo generator");
    const y = step.value;
    if (y.kind === "event" && y.event) {
      ctx.pendingEvents.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.kind === "decision") {
      const req = y.request as { kind?: string; replacementIds?: number[] };
      if (req.kind === "orderReplacements") {
        step = gen.next({ order: [...(req.replacementIds ?? [])] });
        continue;
      }
      throw new Error(`golden runner: unhandled moveTo decision kind '${String(req.kind)}'`);
    }
    step = gen.next();
  }
}

// ── Lookup helpers ───────────────────────────────────────────────────────────

function lookupCardId(
  ctx: RunnerContext,
  name: string,
  expectedZone: ZoneType,
  expectedController: PlayerSeat,
): EntityId {
  const ids = ctx.cardsByName.get(name) ?? [];
  for (const id of ids) {
    const card = ctx.game.cards.get(id);
    if (!card) continue;
    if (card.zone !== expectedZone) continue;
    if (card.controllerSeat !== expectedController) continue;
    return id;
  }
  // Diagnostic: include known cards so failures show what the runner did
  // build vs what was looked up.
  const known = [...ctx.cardsByName.keys()].join(",");
  throw new Error(
    `golden runner: no card '${name}' in zone=${expectedZone} controller=${expectedController as unknown as number} (known cards: [${known}])`,
  );
}

function resolveTarget(ctx: RunnerContext, ref: TargetRef): EntityId {
  if (ref.kind === "card") {
    const ids = ctx.cardsByName.get(ref.name) ?? [];
    const id = ids[0];
    if (id === undefined) throw new Error(`golden runner: target card '${ref.name}' not found`);
    return id;
  }
  // Player target — the engine treats player seats as EntityId in a few
  // damage paths (see lightning-bolt test). We coerce here at the boundary.
  return ref.seat as unknown as EntityId;
}

/**
 * Build the runtime TargetRef shape the cast pipeline's chooseCastTargets
 * decision expects. Distinct from `resolveTarget` (which returns raw
 * EntityIds for SpellAbility constructor binding).
 */
function makeTargetRef(
  ctx: RunnerContext,
  ref: TargetRef,
): { kind: "card"; id: EntityId } | { kind: "player"; seat: PlayerSeat } {
  if (ref.kind === "card") {
    const ids = ctx.cardsByName.get(ref.name) ?? [];
    const id = ids[0];
    if (id === undefined) throw new Error(`golden runner: target card '${ref.name}' not found`);
    return { kind: "card", id };
  }
  return { kind: "player", seat: ref.seat };
}

// ── Trace serialisation ──────────────────────────────────────────────────────

function stripEvent(e: GameEvent): GoldenEvent {
  return {
    kind: e.kind,
    turn: e.turn,
    phase: e.phase,
    payload: normalisePayload(e.payload),
  };
}

/**
 * Recursively convert any branded value (EntityId / PlayerSeat are
 * runtime-numbers) to plain JSON-friendly numbers. Maps and Sets are
 * unrolled into objects/arrays; bigints become string-suffixed.
 */
function normalisePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map(normalisePayload);
  if (value instanceof Set) return [...value].map(normalisePayload);
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) obj[String(k)] = normalisePayload(v);
    return obj;
  }
  if (typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = normalisePayload(v);
    }
    return obj;
  }
  return value;
}

function snapshotFinalState(ctx: RunnerContext): GoldenFinalState {
  const battlefield: GoldenBattlefieldEntry[] = [];
  for (let i = 0; i < 2; i++) {
    const seat = ctx.seats[i] as PlayerSeat;
    const player = ctx.game.getPlayer(seat);
    const zone = player.zones.get(ZoneType.Battlefield);
    if (!zone) continue;
    for (const id of zone.toArray()) {
      const card = ctx.game.cards.get(id);
      if (!card) continue;
      battlefield.push({
        name: card.paperCard.name,
        controller: i,
        tapped: card.tapped,
      });
    }
  }
  // Stable ordering — by controller then by name. Otherwise zone-iteration
  // order leaks into the golden and a benign refactor explodes the diff.
  battlefield.sort((a, b) => a.controller - b.controller || a.name.localeCompare(b.name));

  const graveyards: [string[], string[]] = [[], []];
  for (let i = 0; i < 2; i++) {
    const seat = ctx.seats[i] as PlayerSeat;
    const zone = ctx.game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    if (!zone) continue;
    const list: string[] = [];
    for (const id of zone.toArray()) {
      const c = ctx.game.cards.get(id);
      if (c) list.push(c.paperCard.name);
    }
    list.sort();
    graveyards[i] = list;
  }

  return {
    lifeTotals: [
      ctx.game.getPlayer(ctx.seats[0] as PlayerSeat).life,
      ctx.game.getPlayer(ctx.seats[1] as PlayerSeat).life,
    ],
    handSizes: [
      ctx.game.getPlayer(ctx.seats[0] as PlayerSeat).zones.get(ZoneType.Hand)?.size ?? 0,
      ctx.game.getPlayer(ctx.seats[1] as PlayerSeat).zones.get(ZoneType.Hand)?.size ?? 0,
    ],
    battlefield,
    graveyards,
    stackSize: ctx.game.sharedZones.stack.size,
  };
}

// ── Diff helpers ─────────────────────────────────────────────────────────────

function diffEvent(expected: GoldenEvent, actual: GoldenEvent, idx: number): TraceDivergence | null {
  if (expected.kind !== actual.kind) {
    return {
      path: `events[${idx}].kind`,
      expected: expected.kind,
      actual: actual.kind,
      context: contextWindow(idx, expected, actual),
    };
  }
  if (expected.turn !== actual.turn || expected.phase !== actual.phase) {
    return {
      path: `events[${idx}].turn|phase`,
      expected: { turn: expected.turn, phase: expected.phase },
      actual: { turn: actual.turn, phase: actual.phase },
      context: contextWindow(idx, expected, actual),
    };
  }
  const ej = JSON.stringify(expected.payload);
  const aj = JSON.stringify(actual.payload);
  if (ej !== aj) {
    return {
      path: `events[${idx}].payload`,
      expected: expected.payload,
      actual: actual.payload,
      context: contextWindow(idx, expected, actual),
    };
  }
  return null;
}

function contextWindow(idx: number, expected: GoldenEvent, actual: GoldenEvent): string {
  return `[${idx}] kind=${expected.kind} (expected) vs ${actual.kind} (actual)`;
}

function serialise(trace: GoldenTrace): string {
  // Pretty-printed JSON with stable 2-space indent. Trailing newline so
  // editors don't dirty the file on save.
  return `${JSON.stringify(trace, null, 2)}\n`;
}

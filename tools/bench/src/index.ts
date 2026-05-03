#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// mtg-forge-ts-bench — engine throughput baseline.
//
// Measures cast → resolve → teardown latency on a representative scenario:
// Lightning Bolt at face. Each iteration is end-to-end:
//   1. Build a fresh Game with two seats.
//   2. Mint a Lightning Bolt in seat 0's hand, fund {R} in seat 0's pool.
//   3. Drive the cast pipeline (no targeting prompt is needed since Bolt's
//      target is supplied as a TargetRef to chooseCastTargets).
//   4. Resolve the top of the stack — DealDamage emits LifeChanged on
//      seat 1, then StackItemResolved + CardChangedZone (Bolt → graveyard).
//   5. Drop all references to the Game and let GC reclaim it on the next
//      iteration's allocation pressure.
//
// Outputs:
//   - total wall time
//   - ops/sec (mean throughput)
//   - p50 / p95 / p99 per-op latency (microseconds)
//   - environment metadata (Node, V8, OS) so baselines stay attributable
//
// Why Lightning Bolt at face? It exercises the parts of the engine most
// representative of a "spell"-shaped tick — cost payment, stack push, an
// effect with a target, an SBA pass, and a graveyard zone-move — without
// pulling in static-effect layers or replacement effects. It's the same
// shape used as the smallest golden in the corpus, so per-iteration cost
// here tracks the marginal cost of every parity-tested cast.
//
// Anti-goals:
//   - Java cross-comparison (would need the bridge running; out of scope).
//   - Per-effect microbenchmarks (would need exposed internals + a runner).
//   - Subagent-driven multi-turn games (covered by examples/bot-harness).

import { performance } from "node:perf_hooks";
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
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import {
  Battlefield,
  Card,
  GAME_VERSION,
  Game,
  Graveyard,
  Hand,
  Library,
  ManaPool,
  RandomLegalController,
  resolveStackItem,
} from "@mtg-forge-ts/game";
import type { GameMeta, GameRules } from "@mtg-forge-ts/game";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface BenchConfig {
  readonly iterations: number;
  /** Discarded warmup iterations to let JIT heat the cast/resolve hot paths. */
  readonly warmup: number;
  readonly seedBase: bigint;
}

const DEFAULT_CONFIG: BenchConfig = {
  iterations: 1000,
  warmup: 50,
  seedBase: 0xbe_5_5eedn,
};

// ---------------------------------------------------------------------------
// Card source (inline copy — kept identical to packages/game/test/golden
// scenarios so iteration cost tracks the corpus's marginal cost).
// ---------------------------------------------------------------------------

const LIGHTNING_BOLT_SRC =
  "Name:Lightning Bolt\n" +
  "ManaCost:R\n" +
  "Types:Instant\n" +
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.\n" +
  "Oracle:Lightning Bolt deals 3 damage to any target.\n";

// ---------------------------------------------------------------------------
// Game construction (mirrors golden runner's buildContext shape, stripped
// of the scenario-driven variability — life is fixed at 20/20, hand has
// exactly the bolt, mana pool has exactly {R}.)
// ---------------------------------------------------------------------------

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
  engineVersion: GAME_VERSION,
  forgeSha: "bench",
  cardDataSyncedAt: "1970-01-01T00:00:00Z",
  crVersion: "unknown",
  seed: "0xbench",
};

const ALICE: LobbyPlayer = { id: "alice", name: "Alice", controllerKind: "human" };
const BOB: LobbyPlayer = { id: "bob", name: "Bob", controllerKind: "ai" };

interface BenchHarness {
  readonly game: Game;
  readonly seat0: PlayerSeat;
  readonly seat1: PlayerSeat;
  readonly boltId: EntityId;
}

/** One-shot game built specifically to cast Lightning Bolt at seat 1. */
function buildHarness(seed: bigint, boltDef: CardDefinition): BenchHarness {
  const game = new Game({
    lobbyPlayers: [ALICE, BOB],
    rules: RULES,
    meta: META,
    rng: new SeededRng(seed),
  });

  const seat0 = mkPlayerSeat(0);
  const seat1 = mkPlayerSeat(1);

  // Seed the per-player zones the cast pipeline reads: Library / Hand /
  // Graveyard / Battlefield. Empty libraries are fine — Bolt doesn't draw,
  // and we never advance phases so there's no draw step to underflow.
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }

  // Fund seat 0 with one floating {R} so the cast's R cost is payable
  // without driving the activateManaAbilities decision branch (which
  // would add a permission-prompt to every iteration).
  const pool = new ManaPool();
  pool.add(ManaProduced.colored(Color.Red));
  game.getPlayer(seat0).manaPool = pool;

  // Mint the Lightning Bolt directly into seat 0's hand. Activate every
  // self-registration hook the canonical mintCardInZone runs — Bolt only
  // exercises spellAbilities, but the registry hits are part of "cost of
  // a cast" and we want the benchmark to be apples-to-apples with golden.
  const id = game.newEntityId();
  const paper: PaperCard = {
    name: boltDef.name,
    edition: "BCH",
    collectorNumber: String(id as unknown as number).padStart(4, "0"),
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: boltDef,
  };
  const card = new Card(id, paper, seat0, seat0, ZoneType.Hand);
  game.cards.set(id, card);
  card.activateAbilitiesFromDefinition();
  card.activateTriggersFromDefinition(game);
  card.activateReplacementsFromDefinition(game);
  card.activateKeywordsFromDefinition(game);
  card.activateStaticsFromDefinition(game);
  const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("bench: hand zone missing after seeding");
  hand.add(id);

  return { game, seat0, seat1, boltId: id };
}

// ---------------------------------------------------------------------------
// One bench iteration — cast + resolve + teardown. Returns elapsed time in
// nanoseconds (we use performance.now() in ms, ×1e6 to ns for percentiles).
// ---------------------------------------------------------------------------

function runOneIteration(seed: bigint, boltDef: CardDefinition, scratch: GameEvent[]): number {
  const start = performance.now();

  const harness = buildHarness(seed, boltDef);
  const { game, seat1, boltId } = harness;

  // Drive the cast pipeline. The chooseCastTargets request is answered with
  // a player-target ref pointing at seat 1; everything else gets the
  // first-legal default (and Bolt has no other decisions on this path).
  const castGen = game.castPipeline.run({
    castingPlayer: harness.seat0,
    sourceCardId: boltId,
    originZone: ZoneType.Hand,
    asSpecialAction: false,
  }) as Generator<{ kind: string; event?: GameEvent; request?: DecisionRequest }, unknown, unknown>;
  const castController = new RandomLegalController(game.rng);
  let castStep = castGen.next();
  let safety = 0;
  while (!castStep.done) {
    if (++safety > 1000) throw new Error("bench: runaway cast generator");
    const y = castStep.value;
    if (y.kind === "event" && y.event) {
      scratch.push(y.event);
      castStep = castGen.next();
      continue;
    }
    if (y.kind === "decision" && y.request) {
      const req = y.request;
      if (req.kind === "activateManaAbilities") {
        castStep = castGen.next({ kind: "activateManaAbilities", done: true } as DecisionResponse);
        continue;
      }
      if (req.kind === "chooseCastTargets") {
        castStep = castGen.next({
          kind: "chooseCastTargets",
          targets: [{ kind: "player", seat: seat1 } as const],
        } as unknown as DecisionResponse);
        continue;
      }
      // Fall through to the default controller for anything unexpected —
      // not actually exercised by Bolt but guards against future cast-
      // pipeline additions silently breaking the bench.
      castStep = castGen.next(castController.decide(req));
      continue;
    }
    castStep = castGen.next();
  }

  // Resolve the top of stack. This drives DealDamage → LifeChanged on
  // seat 1, the StackItemResolved synthesis, and the CardChangedZone
  // (Bolt → graveyard) emit. SBAs run inside resolveStackItem.
  const top = game.sharedZones.stack.top();
  if (!top) throw new Error("bench: cast produced no stack item");
  const resolveGen = resolveStackItem(game, top) as Generator<
    { kind: string; event?: GameEvent; request?: { kind?: string; replacementIds?: number[] } },
    void,
    unknown
  >;
  let resolveStep = resolveGen.next();
  safety = 0;
  while (!resolveStep.done) {
    if (++safety > 5000) throw new Error("bench: runaway resolve generator");
    const y = resolveStep.value;
    if (y.kind === "event" && y.event) {
      scratch.push(y.event);
      resolveStep = resolveGen.next();
      continue;
    }
    if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      resolveStep = resolveGen.next({ order: [...(y.request.replacementIds ?? [])] });
      continue;
    }
    resolveStep = resolveGen.next();
  }

  // Teardown: drop the scratch buffer (free events) — the harness itself
  // becomes unreachable when this function returns.
  scratch.length = 0;

  const end = performance.now();
  // performance.now() is sub-millisecond on Node; convert to ns for
  // percentile fidelity (ms × 1e6 = ns).
  return (end - start) * 1_000_000;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

interface Stats {
  readonly count: number;
  readonly totalNs: number;
  readonly meanNs: number;
  readonly p50Ns: number;
  readonly p95Ns: number;
  readonly p99Ns: number;
  readonly minNs: number;
  readonly maxNs: number;
  readonly opsPerSec: number;
}

function computeStats(samples: readonly number[]): Stats {
  if (samples.length === 0) {
    throw new Error("bench: cannot compute stats from zero samples");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const mean = total / sorted.length;
  const pick = (q: number): number => {
    // Nearest-rank percentile — matches what most CI dashboards show and
    // avoids interpolation artefacts at small N.
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    const v = sorted[idx];
    if (v === undefined) throw new Error("bench: percentile index out of range (unreachable)");
    return v;
  };
  const totalSec = total / 1_000_000_000;
  const opsPerSec = totalSec > 0 ? sorted.length / totalSec : 0;
  const minNs = sorted[0];
  const maxNs = sorted[sorted.length - 1];
  if (minNs === undefined || maxNs === undefined) {
    throw new Error("bench: empty sorted samples (unreachable)");
  }
  return {
    count: sorted.length,
    totalNs: total,
    meanNs: mean,
    p50Ns: pick(0.5),
    p95Ns: pick(0.95),
    p99Ns: pick(0.99),
    minNs,
    maxNs,
    opsPerSec,
  };
}

function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(1)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(3)} ms`;
  return `${(ns / 1_000_000_000).toFixed(3)} s`;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function runBench(cfg: BenchConfig): { readonly stats: Stats } {
  // Parse the card definition once — parsing is amortised across all
  // iterations and isn't part of "engine throughput". Forge does the same:
  // its CardDb caches definitions and re-uses them for every spawn.
  const boltDef = parseCard(LIGHTNING_BOLT_SRC, "bench/lightning-bolt.txt");

  // Reusable event scratch buffer. Each iteration drains it; the buffer
  // itself stays allocated so per-iter cost reflects engine work, not
  // ArrayBuffer churn. (Pre-grown so the first iteration's resize doesn't
  // skew the warmup.)
  const scratch: GameEvent[] = [];

  // Warmup — let V8 inline the cast / resolve hot paths. Discarded.
  for (let i = 0; i < cfg.warmup; i++) {
    runOneIteration(cfg.seedBase + BigInt(i), boltDef, scratch);
  }

  const samples = new Float64Array(cfg.iterations);
  for (let i = 0; i < cfg.iterations; i++) {
    samples[i] = runOneIteration(cfg.seedBase + BigInt(cfg.warmup + i), boltDef, scratch);
  }

  return { stats: computeStats(Array.from(samples)) };
}

function printReport(cfg: BenchConfig, stats: Stats): void {
  const out = process.stdout;
  out.write("mtg-forge-ts-bench — Lightning Bolt cast/resolve baseline\n");
  out.write(`engine version: ${GAME_VERSION}\n`);
  out.write(`Node:           ${process.version}\n`);
  out.write(`V8:             ${process.versions.v8}\n`);
  out.write(`Platform:       ${process.platform} ${process.arch}\n`);
  out.write(`Iterations:     ${cfg.iterations} (warmup ${cfg.warmup})\n`);
  out.write("\n");
  out.write("Scenario: Lightning Bolt at face\n");
  out.write("  - build Game (2 seats, fresh zones)\n");
  out.write("  - mint Lightning Bolt in hand, {R} in pool\n");
  out.write("  - drive cast pipeline, target seat 1\n");
  out.write("  - resolveStackItem (DealDamage → LifeChanged → graveyard move)\n");
  out.write("  - drop references for GC\n");
  out.write("\n");
  out.write("Results:\n");
  out.write(`  total wall time:    ${formatNs(stats.totalNs)}\n`);
  out.write(`  ops / sec:          ${stats.opsPerSec.toFixed(1)}\n`);
  out.write(`  mean latency:       ${formatNs(stats.meanNs)}\n`);
  out.write(`  p50 latency:        ${formatNs(stats.p50Ns)}\n`);
  out.write(`  p95 latency:        ${formatNs(stats.p95Ns)}\n`);
  out.write(`  p99 latency:        ${formatNs(stats.p99Ns)}\n`);
  out.write(`  min latency:        ${formatNs(stats.minNs)}\n`);
  out.write(`  max latency:        ${formatNs(stats.maxNs)}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `mtg-forge-ts-bench — engine throughput baseline

Usage:
  mtg-forge-ts-bench [--iterations=<N>] [--warmup=<N>]

Options:
  --iterations=<N>   Number of measured iterations (default 1000).
  --warmup=<N>       Discarded warmup iterations (default 50).
  -h, --help         Show this help.
`;

function parseArgs(argv: readonly string[]): BenchConfig | { readonly help: true } {
  let cfg: BenchConfig = DEFAULT_CONFIG;
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg.startsWith("--iterations=")) {
      const v = Number(arg.slice("--iterations=".length));
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`--iterations must be positive, got ${arg}`);
      }
      cfg = { ...cfg, iterations: Math.floor(v) };
    } else if (arg.startsWith("--warmup=")) {
      const v = Number(arg.slice("--warmup=".length));
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`--warmup must be >= 0, got ${arg}`);
      }
      cfg = { ...cfg, warmup: Math.floor(v) };
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return cfg;
}

function main(argv: readonly string[]): number {
  let cfg: BenchConfig;
  try {
    const parsed = parseArgs(argv);
    if ("help" in parsed) {
      process.stdout.write(USAGE);
      return 0;
    }
    cfg = parsed;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const { stats } = runBench(cfg);
  printReport(cfg, stats);
  return 0;
}

export { runBench, DEFAULT_CONFIG, computeStats };
export type { BenchConfig, Stats };

const exitCode = main(process.argv.slice(2));
process.exit(exitCode);

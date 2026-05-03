#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// mtg-forge-ts-bot-harness — reference AI vs AI consumer for downstream
// developers. This is the deepest of the three reference examples: it
// actually drives the engine's suspendable game generator end-to-end with
// two RandomLegalControllers, one per seat, until the game reaches a
// terminal state (or a turn cap, whichever comes first).
//
// Why it exists: the CLI example shows you how to PARSE a card and how to
// CONSTRUCT a Game; this one shows you how to RUN a Game. It's the proof
// that the engine can host real gameplay rather than just being a pile of
// data structures.
//
// Limitations (documented as TODOs below):
//   - Decks are 60 stub PaperCards keyed by name only — no .txt loading.
//     SP4's CardDb integration replaces this with real card definitions.
//   - The "AI" is RandomLegalController, which always passes priority and
//     never plays cards (random-legal favours pass over action). This means
//     no spells get cast and no creatures attack — but the phase machine,
//     priority loop, turn queue, mulligan flow, cleanup discard, and
//     terminal-state detection are all genuinely exercised.
//   - Without real card definitions, the game won't end via 0-life or deck-
//     out within 5 turns. We cap turns and report "no terminal" as a valid
//     outcome — the harness's job is to prove the loop runs, not to find a
//     winner.
//
// This package is `private: true` and lives under examples/. It is not
// published to npm — copy and adapt freely.

import type {
  DecisionRequest,
  DecisionResponse,
  EntityId,
  GameEvent,
  PaperCard,
  PhaseStep,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { Card, GAME_VERSION, Game, PhaseHandler, RandomLegalController, setupGame } from "@mtg-forge-ts/game";
import type { GameMeta, GameRules, SetupDecks } from "@mtg-forge-ts/game";

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

interface HarnessConfig {
  readonly seed: bigint;
  readonly turnCap: number;
  readonly deckSize: number;
  /** Name shared by every stub card in the deck — purely cosmetic in logs. */
  readonly deckCardName: string;
  /** Hard cap on generator steps to guarantee termination of the harness. */
  readonly stepCap: number;
}

const DEFAULT_CONFIG: HarnessConfig = {
  // Arbitrary "B0T" prefix in hex to make the seed visually identifiable in
  // logs without colliding with any production seed value.
  seed: 0xb0_71234n,
  turnCap: 5,
  deckSize: 60,
  deckCardName: "Grizzly Bears",
  stepCap: 50_000,
};

// ---------------------------------------------------------------------------
// PaperCard / deck construction
// ---------------------------------------------------------------------------

/**
 * Build a stub PaperCard. Until SP4's CardDb is wired up to the cards
 * package, the engine only needs `name` + `edition` + the default flags;
 * everything else is metadata that doesn't influence the SP1/SP2 turn
 * machine. Each entry gets a unique collector number so two stubs with
 * the same name don't collide on PaperCard equality.
 */
const stubPaperCard = (name: string, idx: number): PaperCard => ({
  name,
  edition: "BOT",
  collectorNumber: String(idx + 1).padStart(3, "0"),
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

/**
 * Seed a fresh game with two libraries of `cfg.deckSize` stub cards each.
 * Returns the SetupDecks payload setupGame consumes. Wave-31+ shape:
 * SetupDecks is a `{ [seat: number]: readonly EntityId[] }`.
 */
function seedDecks(game: Game, cfg: HarnessConfig): SetupDecks {
  const decks: Record<number, EntityId[]> = { 0: [], 1: [] };
  for (let seat = 0; seat < 2; seat++) {
    const playerSeat = mkPlayerSeat(seat);
    const bucket = decks[seat];
    if (!bucket) throw new Error("seedDecks: unreachable — bucket missing");
    for (let i = 0; i < cfg.deckSize; i++) {
      const id = game.newEntityId();
      const paper = stubPaperCard(cfg.deckCardName, i);
      const card = new Card(id, paper, playerSeat, playerSeat, ZoneType.Library);
      game.cards.set(id, card);
      bucket.push(id);
    }
  }
  return decks as unknown as SetupDecks;
}

// ---------------------------------------------------------------------------
// game construction
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
  forgeSha: "bot-harness",
  cardDataSyncedAt: "1970-01-01T00:00:00Z",
  crVersion: "unknown",
  seed: "0xb071234",
};

function buildGame(cfg: HarnessConfig): Game {
  return new Game({
    lobbyPlayers: [
      { id: "alice", name: "Alice", controllerKind: "ai" },
      { id: "bob", name: "Bob", controllerKind: "ai" },
    ],
    rules: RULES,
    meta: META,
    rng: new SeededRng(cfg.seed),
  });
}

// ---------------------------------------------------------------------------
// driver — feeds RandomLegalControllers into setupGame + PhaseHandler.run()
// ---------------------------------------------------------------------------

interface RunResult {
  readonly events: readonly GameEvent[];
  readonly turnsCompleted: number;
  readonly terminal: boolean;
  readonly winner: PlayerSeat | null;
  readonly endReason: string | null;
  readonly stepCount: number;
  readonly capped: boolean;
}

function runHarness(cfg: HarnessConfig): { readonly game: Game; readonly result: RunResult } {
  const game = buildGame(cfg);
  const decks = seedDecks(game, cfg);

  // Each controller has its own RNG branch so the per-seat decision streams
  // are independent (re-seeding the same SeededRng instance for both seats
  // would mean both players make the same random pick at every fork). The
  // root config seed mixes via XOR into per-seat seeds.
  const rngSeat0 = new SeededRng(cfg.seed ^ 0xa11ce_5eedn);
  const rngSeat1 = new SeededRng(cfg.seed ^ 0xb0b_5eed_2n);

  const controllers = new Map<PlayerSeat, RandomLegalController>([
    [mkPlayerSeat(0), new RandomLegalController(rngSeat0)],
    [mkPlayerSeat(1), new RandomLegalController(rngSeat1)],
  ]);

  // Drive setup first so we can inspect / shape the turn queue afterwards.
  // (runGame would auto-seed one turn per seat — but we want N turns.)
  const events: GameEvent[] = [];
  const setupGen = setupGame(game, { decks });
  let setupStep = setupGen.next();
  let stepCount = 0;
  while (!setupStep.done) {
    stepCount++;
    if (stepCount > cfg.stepCap) {
      throw new Error(`harness: setup exceeded ${cfg.stepCap} generator steps — likely a controller bug`);
    }
    if (setupStep.value.kind === "decision") {
      const req: DecisionRequest = setupStep.value.request;
      if (!("playerSeat" in req)) {
        throw new Error(`harness: setup yielded non-seat request kind=${req.kind}`);
      }
      const seat: PlayerSeat = req.playerSeat;
      const controller = controllers.get(seat);
      if (!controller) {
        throw new Error(`harness: no controller registered for seat ${seat as unknown as number}`);
      }
      const response: DecisionResponse = controller.decide(req);
      setupStep = setupGen.next(response);
    } else {
      events.push(setupStep.value.event);
      setupStep = setupGen.next();
    }
  }

  // Setup may have produced a terminal state already (e.g. starting-hand
  // SBAs in an exotic format). Bail out cleanly if so.
  if (game.isTerminal()) {
    return { game, result: summarize(game, events, stepCount, false) };
  }

  // Seed N turns into the queue (interleaved seat order). PhaseHandler.run()
  // walks the queue; if it empties, the loop exits naturally.
  const phaseHandler = new PhaseHandler(game);
  for (let t = 0; t < cfg.turnCap; t++) {
    const seat = mkPlayerSeat(t % 2);
    phaseHandler.turnQueue.push({ activePlayer: seat, isExtra: false });
  }

  const phaseGen = phaseHandler.run();
  let phaseStep = phaseGen.next();
  let capped = false;
  while (!phaseStep.done) {
    stepCount++;
    if (stepCount > cfg.stepCap) {
      capped = true;
      break;
    }
    if (phaseStep.value.kind === "decision") {
      const req: DecisionRequest = phaseStep.value.request;
      if (!("playerSeat" in req)) {
        throw new Error(`harness: run yielded non-seat request kind=${req.kind}`);
      }
      const seat: PlayerSeat = req.playerSeat;
      const controller = controllers.get(seat);
      if (!controller) {
        throw new Error(`harness: no controller registered for seat ${seat as unknown as number}`);
      }
      const response: DecisionResponse = controller.decide(req);
      phaseStep = phaseGen.next(response);
    } else {
      events.push(phaseStep.value.event);
      phaseStep = phaseGen.next();
    }
  }

  return { game, result: summarize(game, events, stepCount, capped) };
}

function summarize(game: Game, events: readonly GameEvent[], stepCount: number, capped: boolean): RunResult {
  const turnsStarted = events.filter((e) => e.kind === "TurnStarted").length;
  const terminal = game.isTerminal();
  let winner: PlayerSeat | null = null;
  let endReason: string | null = null;
  if (terminal && game.terminalState) {
    const outcome = game.terminalState.outcome;
    if (outcome.kind === "win") {
      winner = outcome.winner;
      endReason = outcome.reason;
    } else if (outcome.kind === "draw") {
      endReason = `draw: ${outcome.reason}`;
    }
  }
  return {
    events,
    turnsCompleted: turnsStarted,
    terminal,
    winner,
    endReason,
    stepCount,
    capped,
  };
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

/**
 * Resolve `cardId` → human-readable name through game.cards. We avoid taking
 * a Game reference into the report path by snapshotting names up front in
 * a Map so the same lookup table can be reused across all event lines.
 */
function buildCardNames(game: Game): Map<EntityId, string> {
  const m = new Map<EntityId, string>();
  for (const [id, card] of game.cards.entries()) {
    m.set(id, card.paperCard.name);
  }
  return m;
}

/**
 * Pull a cardId off of a GameEvent payload if there is one. Most kinds of
 * GameEvent put it under `payload.cardId` but a few (e.g. Damage) name the
 * source/target separately — we surface whichever shows up first.
 */
function extractCardId(event: GameEvent): EntityId | null {
  const payload = (event as { payload?: unknown }).payload;
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  const candidates = ["cardId", "sourceId", "targetId"] as const;
  for (const key of candidates) {
    const v = obj[key];
    if (typeof v === "number") return v as unknown as EntityId;
  }
  return null;
}

function formatEvent(event: GameEvent, names: Map<EntityId, string>): string {
  const id = extractCardId(event);
  const cardName = id !== null ? (names.get(id) ?? "?") : "—";
  const phase: PhaseStep = event.phase;
  return `T${event.turn} ${phase} ${event.kind} card=${cardName}`;
}

function printReport(result: RunResult, game: Game, cfg: HarnessConfig): void {
  const out = process.stdout;
  out.write(`mtg-forge-ts-bot-harness — engine ${GAME_VERSION}\n`);
  out.write(`seed=${cfg.seed.toString(16)} turnCap=${cfg.turnCap} deckSize=${cfg.deckSize}\n`);
  out.write("Players: Alice (seat 0, ai) vs Bob (seat 1, ai) — RandomLegalController\n\n");

  const names = buildCardNames(game);

  // Event log — filter to "interesting" lines (skip the per-step phase/
  // priority spam) so the harness output stays under a screen even on a
  // 5-turn run. Showing every event of every kind is easy if you want it:
  // remove the filter below.
  const noisyKinds = new Set<string>([
    "PriorityPassed",
    "PriorityGranted",
    "PhaseStepEntered",
    "PhaseStepExited",
  ]);
  const interesting = result.events.filter((e) => !noisyKinds.has(e.kind));

  out.write(`Event log (${interesting.length}/${result.events.length} interesting events):\n`);
  for (const event of interesting) {
    out.write(`  ${formatEvent(event, names)}\n`);
  }

  out.write("\nFinal summary:\n");
  out.write(`  total events:      ${result.events.length}\n`);
  out.write(`  turns started:     ${result.turnsCompleted}\n`);
  out.write(`  generator steps:   ${result.stepCount}${result.capped ? " (HIT STEP CAP)" : ""}\n`);
  out.write(`  terminal:          ${result.terminal}\n`);
  if (result.winner !== null) {
    const seat = result.winner as unknown as number;
    const name = game.players[seat]?.lobbyPlayer.name ?? `seat ${seat}`;
    out.write(`  winner:            ${name} (seat ${seat})\n`);
  } else {
    out.write("  winner:            none — turn cap reached without terminal state\n");
  }
  if (result.endReason) {
    out.write(`  end reason:        ${result.endReason}\n`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const USAGE = `mtg-forge-ts-bot-harness — runs an AI vs AI scripted game

Usage:
  mtg-forge-ts-bot-harness [--seed=<hex>] [--turns=<N>] [--deck-size=<N>]

Options:
  --seed=<hex>       Hex (e.g. 0xb071234) used as SeededRng root seed.
                     Defaults to 0xb071234.
  --turns=<N>        Cap on turns added to the turn queue (default 5).
  --deck-size=<N>    Stub-card library size per seat (default 60).
  -h, --help         Show this help.
`;

function parseArgs(argv: readonly string[]): HarnessConfig | { readonly help: true } {
  let cfg: HarnessConfig = DEFAULT_CONFIG;
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg.startsWith("--seed=")) {
      const v = arg.slice("--seed=".length);
      cfg = { ...cfg, seed: BigInt(v) };
    } else if (arg.startsWith("--turns=")) {
      const v = Number(arg.slice("--turns=".length));
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--turns must be a positive integer, got ${arg}`);
      cfg = { ...cfg, turnCap: Math.floor(v) };
    } else if (arg.startsWith("--deck-size=")) {
      const v = Number(arg.slice("--deck-size=".length));
      if (!Number.isFinite(v) || v < 7)
        throw new Error(`--deck-size must be >= 7 (starting hand), got ${arg}`);
      cfg = { ...cfg, deckSize: Math.floor(v) };
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return cfg;
}

function main(argv: readonly string[]): number {
  let cfg: HarnessConfig;
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

  const { game, result } = runHarness(cfg);
  printReport(result, game, cfg);
  // Exit 0 when the loop ran cleanly even if the cap fired — the harness's
  // success criterion is "the engine produced events and didn't throw".
  return 0;
}

// keep the runHarness export reachable for unit-test consumers
export { runHarness, DEFAULT_CONFIG };
export type { HarnessConfig, RunResult };

const exitCode = main(process.argv.slice(2));
process.exit(exitCode);

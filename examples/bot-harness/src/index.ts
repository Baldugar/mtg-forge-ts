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
// Variant gameplay (Wave 60+):
//   The harness now accepts CLI flags that wire optional variant payloads
//   into setupGame's SetupOptions:
//     --vanguard=<seat>:<cardName>         (repeatable, CR 902)
//     --conspiracy=<seat>:<cardName>       (repeatable, CR 901)
//     --planechase=<seat>:<activePlane>    (single, CR 901 — planar deck)
//     --archenemy=<seat>:<startingLife>    (single, CR 904 — scheme deck)
//     --mode=2hg                            (CR 810 — 4 seats / 2 teams)
//   Cards referenced by name are minted as stub PaperCards (no script body
//   resolved) — setup-validation only checks names, so the engine accepts
//   the placement even though no triggers/statics activate. When a future
//   revision wires CardDb, the same flags can flow real CardDefinitions in.
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
import type {
  ArchenemyAssignment,
  ConspiracyAssignment,
  GameMeta,
  GameRules,
  PlanechaseAssignment,
  SetupDecks,
  TeamAssignment,
  VanguardAssignment,
} from "@mtg-forge-ts/game";

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

/** Per-seat Vanguard avatar, keyed by card name (resolved at mint time). */
interface VanguardSpec {
  readonly seat: number;
  readonly cardName: string;
}

/** Per-seat Conspiracy card, keyed by card name. */
interface ConspiracySpec {
  readonly seat: number;
  readonly cardName: string;
}

/** Per-seat Planechase active plane (single entry — see CR 901.6). */
interface PlanechaseSpec {
  readonly seat: number;
  readonly activePlane: string;
}

/** Per-seat Archenemy designation with explicit starting-life override. */
interface ArchenemySpec {
  readonly seat: number;
  readonly startingLife: number;
}

interface HarnessConfig {
  readonly seed: bigint;
  readonly turnCap: number;
  readonly deckSize: number;
  /** Name shared by every stub card in the deck — purely cosmetic in logs. */
  readonly deckCardName: string;
  /** Hard cap on generator steps to guarantee termination of the harness. */
  readonly stepCap: number;
  /** "2hg" widens the lobby to 4 seats / 2 teams; null = vanilla 2-seat. */
  readonly mode: "vanilla" | "2hg";
  readonly vanguard: readonly VanguardSpec[];
  readonly conspiracy: readonly ConspiracySpec[];
  readonly planechase: PlanechaseSpec | null;
  readonly archenemy: ArchenemySpec | null;
}

const DEFAULT_CONFIG: HarnessConfig = {
  // Arbitrary "B0T" prefix in hex to make the seed visually identifiable in
  // logs without colliding with any production seed value.
  seed: 0xb0_71234n,
  turnCap: 5,
  deckSize: 60,
  deckCardName: "Grizzly Bears",
  stepCap: 50_000,
  mode: "vanilla",
  vanguard: [],
  conspiracy: [],
  planechase: null,
  archenemy: null,
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
const stubPaperCard = (name: string, idx: number, edition = "BOT"): PaperCard => ({
  name,
  edition,
  collectorNumber: String(idx + 1).padStart(3, "0"),
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

/**
 * Mint a single card outside the library (for variant zones — Vanguard
 * avatars, Conspiracies, planes, schemes — which never live in a player's
 * 60-card library). The placeholder zone is rewritten by setupGame.
 */
function mintVariantCard(
  game: Game,
  cardName: string,
  seat: PlayerSeat,
  zone: ZoneType,
  edition: string,
): EntityId {
  const id = game.newEntityId();
  const paper = stubPaperCard(cardName, id as unknown as number, edition);
  game.cards.set(id, new Card(id, paper, seat, seat, zone));
  return id;
}

/**
 * Seed a fresh game with `seatCount` libraries of `cfg.deckSize` stub cards
 * each. Returns the SetupDecks payload setupGame consumes. Wave-31+ shape:
 * SetupDecks is a `{ [seat: number]: readonly EntityId[] }`.
 *
 * `seatRng` lets each seat's library be shuffled with an independent RNG
 * branch — the 2HG mode XORs `cfg.seed` per seat so all four players get
 * deterministic-but-distinct starting decks under the same root seed.
 */
function seedDecks(game: Game, cfg: HarnessConfig, seatCount: number): SetupDecks {
  const decks: Record<number, EntityId[]> = {};
  for (let seat = 0; seat < seatCount; seat++) {
    const playerSeat = mkPlayerSeat(seat);
    const bucket: EntityId[] = [];
    for (let i = 0; i < cfg.deckSize; i++) {
      const id = game.newEntityId();
      const paper = stubPaperCard(cfg.deckCardName, i);
      const card = new Card(id, paper, playerSeat, playerSeat, ZoneType.Library);
      game.cards.set(id, card);
      bucket.push(id);
    }
    decks[seat] = bucket;
  }
  return decks as unknown as SetupDecks;
}

// ---------------------------------------------------------------------------
// game construction
// ---------------------------------------------------------------------------

const META: GameMeta = {
  engineVersion: GAME_VERSION,
  forgeSha: "bot-harness",
  cardDataSyncedAt: "1970-01-01T00:00:00Z",
  crVersion: "unknown",
  seed: "0xb071234",
};

/**
 * Pick the GameRules + lobby shape based on `cfg.mode`. Vanilla is the
 * historical 2-seat AI vs AI; 2hg widens to 4 seats with the
 * `TwoHeadedGiant` variant flag and a teamAssignments array (seats 0+1 →
 * team 0, seats 2+3 → team 1) so Game's ctor seeds the team-life pool.
 */
function ruleSetFor(cfg: HarnessConfig): {
  readonly rules: GameRules;
  readonly lobby: ReadonlyArray<{ id: string; name: string; controllerKind: "ai" }>;
  readonly seatCount: number;
} {
  if (cfg.mode === "2hg") {
    return {
      rules: {
        formatId: "two-headed-giant",
        startingLife: 30,
        startingHandSize: 7,
        mulliganRule: "london",
        firstPlayerSkipsDraw: true,
        ruleOverrides: [],
        playerCount: { min: 4, max: 4 },
        teamAssignments: [0, 0, 1, 1],
        poisonCountersToLose: 15,
        playForAnte: false,
        manaBurn: false,
        appliedVariants: ["TwoHeadedGiant"],
      },
      lobby: [
        { id: "alice", name: "Alice", controllerKind: "ai" },
        { id: "bob", name: "Bob", controllerKind: "ai" },
        { id: "carol", name: "Carol", controllerKind: "ai" },
        { id: "dave", name: "Dave", controllerKind: "ai" },
      ],
      seatCount: 4,
    };
  }
  return {
    rules: {
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
    },
    lobby: [
      { id: "alice", name: "Alice", controllerKind: "ai" },
      { id: "bob", name: "Bob", controllerKind: "ai" },
    ],
    seatCount: 2,
  };
}

function buildGame(cfg: HarnessConfig, ruleSet: ReturnType<typeof ruleSetFor>): Game {
  return new Game({
    lobbyPlayers: ruleSet.lobby.map((p) => ({ ...p })),
    rules: ruleSet.rules,
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

/**
 * Materialize the parsed CLI flags into the SetupOptions payload. Returns
 * the constructed assignment arrays alongside the variant card EntityIds
 * so we can keep them visible in the report.
 */
function buildVariantAssignments(
  game: Game,
  cfg: HarnessConfig,
  seatCount: number,
): {
  readonly vanguard: readonly VanguardAssignment[];
  readonly conspiracies: readonly ConspiracyAssignment[];
  readonly planechase: readonly PlanechaseAssignment[];
  readonly archenemy: readonly ArchenemyAssignment[];
  readonly teams: readonly TeamAssignment[];
} {
  const validateSeat = (seat: number, label: string): void => {
    if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount) {
      throw new Error(`${label}: seat ${seat} out of range [0, ${seatCount})`);
    }
  };

  const vanguard: VanguardAssignment[] = cfg.vanguard.map((spec) => {
    validateSeat(spec.seat, "--vanguard");
    const seat = mkPlayerSeat(spec.seat);
    const cardId = mintVariantCard(game, spec.cardName, seat, ZoneType.Command, "VAN");
    return { seat, cardId };
  });

  const conspiracies: ConspiracyAssignment[] = cfg.conspiracy.map((spec) => {
    validateSeat(spec.seat, "--conspiracy");
    const seat = mkPlayerSeat(spec.seat);
    const cardId = mintVariantCard(game, spec.cardName, seat, ZoneType.Command, "CN2");
    return { seat, cardId };
  });

  const planechase: PlanechaseAssignment[] = [];
  if (cfg.planechase) {
    validateSeat(cfg.planechase.seat, "--planechase");
    const seat = mkPlayerSeat(cfg.planechase.seat);
    const activePlane = mintVariantCard(game, cfg.planechase.activePlane, seat, ZoneType.Command, "PCH");
    planechase.push({ seat, planarDeck: [], activePlane });
  }

  const archenemy: ArchenemyAssignment[] = [];
  if (cfg.archenemy) {
    validateSeat(cfg.archenemy.seat, "--archenemy");
    const seat = mkPlayerSeat(cfg.archenemy.seat);
    archenemy.push({ seat, schemeDeck: [], startingLife: cfg.archenemy.startingLife });
  }

  const teams: TeamAssignment[] =
    cfg.mode === "2hg"
      ? [
          { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
          { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
        ]
      : [];

  return { vanguard, conspiracies, planechase, archenemy, teams };
}

function runHarness(cfg: HarnessConfig): { readonly game: Game; readonly result: RunResult } {
  const ruleSet = ruleSetFor(cfg);
  const game = buildGame(cfg, ruleSet);
  const decks = seedDecks(game, cfg, ruleSet.seatCount);
  const variants = buildVariantAssignments(game, cfg, ruleSet.seatCount);

  // Each controller has its own RNG branch so the per-seat decision streams
  // are independent (re-seeding the same SeededRng instance for every seat
  // would mean all players make the same random pick at every fork). The
  // root config seed mixes via XOR into per-seat seeds — for 2HG we need
  // four distinct branches (one per seat), so the magic constants below
  // are arbitrary distinct 64-bit XOR offsets.
  const SEAT_RNG_SALTS: readonly bigint[] = [0xa11ce_5eedn, 0xb0b_5eed_2n, 0xca401_5eed_3n, 0xda3e_5eed_4n];

  const controllers = new Map<PlayerSeat, RandomLegalController>();
  for (let seat = 0; seat < ruleSet.seatCount; seat++) {
    const salt = SEAT_RNG_SALTS[seat] ?? BigInt(seat + 1) * 0x9e37_79b9_7f4a_7c15n;
    const rng = new SeededRng(cfg.seed ^ salt);
    controllers.set(mkPlayerSeat(seat), new RandomLegalController(rng));
  }

  // Drive setup first so we can inspect / shape the turn queue afterwards.
  // (runGame would auto-seed one turn per seat — but we want N turns.)
  const events: GameEvent[] = [];
  // Only forward each variant payload when it has entries — setupGame
  // treats `teams: []` (and similar) as "validate every seat is covered"
  // which would mis-fire for the non-2HG paths where we pass an empty
  // assignment array unconditionally.
  const setupGen = setupGame(game, {
    decks,
    ...(variants.vanguard.length > 0 ? { vanguard: variants.vanguard } : {}),
    ...(variants.conspiracies.length > 0 ? { conspiracies: variants.conspiracies } : {}),
    ...(variants.planechase.length > 0 ? { planechase: variants.planechase } : {}),
    ...(variants.archenemy.length > 0 ? { archenemy: variants.archenemy } : {}),
    ...(variants.teams.length > 0 ? { teams: variants.teams } : {}),
  });
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
    const seat = mkPlayerSeat(t % ruleSet.seatCount);
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
  out.write(
    `seed=${cfg.seed.toString(16)} turnCap=${cfg.turnCap} deckSize=${cfg.deckSize} mode=${cfg.mode}\n`,
  );
  if (cfg.vanguard.length > 0) {
    out.write(`Vanguard: ${cfg.vanguard.map((v) => `seat${v.seat}=${v.cardName}`).join(", ")}\n`);
  }
  if (cfg.conspiracy.length > 0) {
    out.write(`Conspiracy: ${cfg.conspiracy.map((c) => `seat${c.seat}=${c.cardName}`).join(", ")}\n`);
  }
  if (cfg.planechase) {
    out.write(`Planechase: seat${cfg.planechase.seat} activePlane=${cfg.planechase.activePlane}\n`);
  }
  if (cfg.archenemy) {
    out.write(`Archenemy: seat${cfg.archenemy.seat} startingLife=${cfg.archenemy.startingLife}\n`);
  }
  const lobbyNames = game.players.map((p, i) => `${p.lobbyPlayer.name} (seat ${i})`).join(", ");
  out.write(`Players: ${lobbyNames} — RandomLegalController\n\n`);

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
                           [--mode=2hg]
                           [--vanguard=<seat>:<cardName>]...
                           [--conspiracy=<seat>:<cardName>]...
                           [--planechase=<seat>:<activePlane>]
                           [--archenemy=<seat>:<startingLife>]

Options:
  --seed=<hex>                       Hex (e.g. 0xb071234) used as SeededRng
                                     root seed. Defaults to 0xb071234.
  --turns=<N>                        Cap on turns added to the turn queue
                                     (default 5).
  --deck-size=<N>                    Stub-card library size per seat
                                     (default 60, must be >= 7).
  --mode=2hg                         Two-Headed Giant: 4 seats / 2 teams
                                     sharing 30 life apiece. Default is
                                     vanilla 2-seat AI vs AI.
  --vanguard=<seat>:<cardName>       Seat <seat> plays as Vanguard avatar
                                     <cardName>. Repeatable (one per seat).
  --conspiracy=<seat>:<cardName>     Seed Conspiracy <cardName> into seat
                                     <seat>'s command zone. Repeatable.
  --planechase=<seat>:<activePlane>  Seat <seat> is the active plane's host;
                                     <activePlane> goes face-up in the
                                     command zone. Single-shot.
  --archenemy=<seat>:<startingLife>  Seat <seat> is the archenemy with the
                                     given starting life total (CR 904.5
                                     defaults to 40). Single-shot.
  -h, --help                         Show this help.

Examples:
  bot-harness --turns=10 --vanguard=0:'Akroma, Angel of Wrath Avatar'
  bot-harness --conspiracy=0:'Power Play' --conspiracy=1:'Backup Plan'
  bot-harness --planechase=0:'Academy at Tolaria West'
  bot-harness --archenemy=0:40
  bot-harness --mode=2hg --turns=3
`;

/**
 * Split a "<seat>:<value>" arg into its parts. Returns null if the format
 * is malformed (caller surfaces a friendly error message including the
 * offending flag name).
 */
function splitSeatValue(raw: string): { seat: number; value: string } | null {
  const colon = raw.indexOf(":");
  if (colon <= 0 || colon >= raw.length - 1) return null;
  const seat = Number(raw.slice(0, colon));
  if (!Number.isInteger(seat) || seat < 0) return null;
  return { seat, value: raw.slice(colon + 1) };
}

function parseArgs(argv: readonly string[]): HarnessConfig | { readonly help: true } {
  let cfg: HarnessConfig = DEFAULT_CONFIG;
  const vanguard: VanguardSpec[] = [];
  const conspiracy: ConspiracySpec[] = [];
  for (const arg of argv) {
    // Some shells / pnpm forwarding tokenize a literal "--" separator into
    // argv. Treat it as a no-op so callers can write either
    //   `pnpm --filter <pkg> dev --mode=2hg`
    // or
    //   `pnpm --filter <pkg> dev -- --mode=2hg`
    // and get the same result.
    if (arg === "--") continue;
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
    } else if (arg.startsWith("--mode=")) {
      const v = arg.slice("--mode=".length);
      if (v !== "2hg") throw new Error(`--mode supports '2hg' only, got ${arg}`);
      cfg = { ...cfg, mode: "2hg" };
    } else if (arg.startsWith("--vanguard=")) {
      const split = splitSeatValue(arg.slice("--vanguard=".length));
      if (!split) throw new Error(`--vanguard must be <seat>:<cardName>, got ${arg}`);
      vanguard.push({ seat: split.seat, cardName: split.value });
    } else if (arg.startsWith("--conspiracy=")) {
      const split = splitSeatValue(arg.slice("--conspiracy=".length));
      if (!split) throw new Error(`--conspiracy must be <seat>:<cardName>, got ${arg}`);
      conspiracy.push({ seat: split.seat, cardName: split.value });
    } else if (arg.startsWith("--planechase=")) {
      const split = splitSeatValue(arg.slice("--planechase=".length));
      if (!split) throw new Error(`--planechase must be <seat>:<activePlane>, got ${arg}`);
      if (cfg.planechase) throw new Error("--planechase may only be specified once");
      cfg = { ...cfg, planechase: { seat: split.seat, activePlane: split.value } };
    } else if (arg.startsWith("--archenemy=")) {
      const split = splitSeatValue(arg.slice("--archenemy=".length));
      if (!split) throw new Error(`--archenemy must be <seat>:<startingLife>, got ${arg}`);
      if (cfg.archenemy) throw new Error("--archenemy may only be specified once");
      const life = Number(split.value);
      if (!Number.isFinite(life) || life <= 0)
        throw new Error(`--archenemy startingLife must be a positive integer, got ${arg}`);
      cfg = { ...cfg, archenemy: { seat: split.seat, startingLife: Math.floor(life) } };
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return { ...cfg, vanguard, conspiracy };
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

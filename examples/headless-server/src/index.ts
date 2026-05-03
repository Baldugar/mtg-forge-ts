#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// mtg-forge-ts-headless-server — reference HTTP server consumer for downstream
// developers. Demonstrates the engine running as a stateless backend service:
// each request constructs its own fresh Game, runs the requested operation,
// and returns the result as JSON. No state is shared between requests.
//
// This is the fourth reference example, alongside cli (one-shot CLI),
// browser-worker (Web Worker), and bot-harness (programmatic AI vs AI). The
// headless server makes the engine usable from non-Node clients (curl, browser
// fetch, other backends) without bundling any framework dependencies — it
// uses only the built-in `node:http` module.
//
// Endpoints:
//   GET  /health         — { ok: true, version: <engine version> }
//   POST /parse-card     — body: { script: string }
//                          returns: parsed CardDefinition AST (or { error })
//   POST /validate-deck  — body: { deck: DeckEntry[], format: FormatId }
//                          returns: DeckValidationResult (or { error })
//   POST /run-game       — body: { seed: number|string, turns: number }
//                          returns: { events: GameEvent[], summary: ... }
//
// This package is `private: true` and lives under examples/. It is not
// published to npm — copy and adapt freely.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseCard, validateDeck } from "@mtg-forge-ts/cards";
import type { DeckEntry, FormatId } from "@mtg-forge-ts/cards";
import type {
  DecisionRequest,
  DecisionResponse,
  EntityId,
  GameEvent,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { Card, GAME_VERSION, Game, PhaseHandler, RandomLegalController, setupGame } from "@mtg-forge-ts/game";
import type { GameMeta, GameRules, SetupDecks } from "@mtg-forge-ts/game";

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1_000_000; // 1 MiB request-body cap to bound memory.
const MAX_RUN_TURNS = 50; // hard ceiling to prevent runaway /run-game requests
const MAX_RUN_STEPS = 100_000; // generator-step cap per /run-game request

const VALID_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>([
  "standard",
  "modern",
  "legacy",
  "vintage",
  "pioneer",
  "pauper",
  "commander",
]);

// ---------------------------------------------------------------------------
// small helpers — request body, JSON responses, error wrapping
// ---------------------------------------------------------------------------

interface JsonError {
  readonly error: string;
  readonly detail?: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload, "utf8"),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, error: string, detail?: string): void {
  const body: JsonError = detail !== undefined ? { error, detail } : { error };
  sendJson(res, status, body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err: Error) => reject(err));
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

interface HealthResponse {
  readonly ok: true;
  readonly version: string;
}

function handleHealth(res: ServerResponse): void {
  const body: HealthResponse = { ok: true, version: GAME_VERSION };
  sendJson(res, 200, body);
}

// ---------------------------------------------------------------------------
// /parse-card
// ---------------------------------------------------------------------------

function handleParseCard(body: unknown, res: ServerResponse): void {
  if (typeof body !== "object" || body === null || !("script" in body)) {
    sendError(res, 400, "missing field 'script'");
    return;
  }
  const script = (body as { script: unknown }).script;
  if (typeof script !== "string") {
    sendError(res, 400, "field 'script' must be a string");
    return;
  }
  let card: ReturnType<typeof parseCard>;
  try {
    card = parseCard(script, "<request>");
  } catch (err) {
    sendError(res, 422, "parse-card failed", (err as Error).message);
    return;
  }
  // CardDefinition contains Map / Set instances (e.g. svars, colors). Re-serialise
  // those into JSON-friendly shapes so JSON.stringify doesn't drop them silently.
  sendJson(res, 200, normaliseForJson(card));
}

// ---------------------------------------------------------------------------
// /validate-deck
// ---------------------------------------------------------------------------

function handleValidateDeck(body: unknown, res: ServerResponse): void {
  if (typeof body !== "object" || body === null) {
    sendError(res, 400, "request body must be a JSON object");
    return;
  }
  const obj = body as { deck?: unknown; format?: unknown };
  if (!Array.isArray(obj.deck)) {
    sendError(res, 400, "field 'deck' must be a DeckEntry[]");
    return;
  }
  if (typeof obj.format !== "string" || !(VALID_FORMATS as ReadonlySet<string>).has(obj.format)) {
    sendError(res, 400, `field 'format' must be one of: ${Array.from(VALID_FORMATS).join(", ")}`);
    return;
  }
  const format = obj.format as FormatId;
  // Light sanity check on each entry — we leave deeper schema enforcement to
  // validateDeck itself, which already rejects malformed entries.
  for (const entry of obj.deck) {
    if (typeof entry !== "object" || entry === null) {
      sendError(res, 400, "every deck entry must be an object");
      return;
    }
    const e = entry as { name?: unknown; count?: unknown };
    if (typeof e.name !== "string" || typeof e.count !== "number") {
      sendError(res, 400, "every deck entry needs string 'name' and number 'count'");
      return;
    }
  }
  let result: ReturnType<typeof validateDeck>;
  try {
    result = validateDeck(obj.deck as readonly DeckEntry[], format);
  } catch (err) {
    sendError(res, 422, "validate-deck failed", (err as Error).message);
    return;
  }
  sendJson(res, 200, result);
}

// ---------------------------------------------------------------------------
// /run-game — bot-harness-style fresh AI vs AI run, no shared state
// ---------------------------------------------------------------------------

interface RunGameRequestBody {
  readonly seed: bigint;
  readonly turns: number;
}

function parseRunGameBody(body: unknown): RunGameRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new Error("request body must be a JSON object");
  }
  const obj = body as { seed?: unknown; turns?: unknown };
  let seed: bigint;
  if (typeof obj.seed === "number") {
    if (!Number.isFinite(obj.seed)) throw new Error("'seed' must be a finite number");
    seed = BigInt(Math.trunc(obj.seed));
  } else if (typeof obj.seed === "string") {
    try {
      seed = BigInt(obj.seed);
    } catch {
      throw new Error("'seed' string must be BigInt-parseable (e.g. '0x2a' or '42')");
    }
  } else {
    throw new Error("'seed' must be a number or BigInt-parseable string");
  }
  if (typeof obj.turns !== "number" || !Number.isFinite(obj.turns) || obj.turns <= 0) {
    throw new Error("'turns' must be a positive number");
  }
  const turns = Math.min(Math.floor(obj.turns), MAX_RUN_TURNS);
  return { seed, turns };
}

interface RunGameResponseBody {
  readonly events: readonly unknown[];
  readonly summary: {
    readonly turnsStarted: number;
    readonly totalEvents: number;
    readonly stepCount: number;
    readonly terminal: boolean;
    readonly winnerSeat: number | null;
    readonly endReason: string | null;
    readonly capped: boolean;
  };
}

function handleRunGame(body: unknown, res: ServerResponse): void {
  let parsed: RunGameRequestBody;
  try {
    parsed = parseRunGameBody(body);
  } catch (err) {
    sendError(res, 400, "invalid /run-game body", (err as Error).message);
    return;
  }

  let response: RunGameResponseBody;
  try {
    response = runGame(parsed);
  } catch (err) {
    sendError(res, 500, "run-game failed", (err as Error).message);
    return;
  }
  sendJson(res, 200, response);
}

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

const STUB_DECK_NAME = "Grizzly Bears";
const STUB_DECK_SIZE = 60;

function stubPaperCard(name: string, idx: number): PaperCard {
  return {
    name,
    edition: "HSV",
    collectorNumber: String(idx + 1).padStart(3, "0"),
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
  };
}

function seedDecks(game: Game): SetupDecks {
  const decks: Record<number, EntityId[]> = { 0: [], 1: [] };
  for (let seat = 0; seat < 2; seat++) {
    const playerSeat = mkPlayerSeat(seat);
    const bucket = decks[seat];
    if (!bucket) throw new Error("seedDecks: unreachable — bucket missing");
    for (let i = 0; i < STUB_DECK_SIZE; i++) {
      const id = game.newEntityId();
      const paper = stubPaperCard(STUB_DECK_NAME, i);
      const card = new Card(id, paper, playerSeat, playerSeat, ZoneType.Library);
      game.cards.set(id, card);
      bucket.push(id);
    }
  }
  return decks as unknown as SetupDecks;
}

/**
 * Stateless game runner. Constructs a fresh Game per call — no shared engine
 * state across requests. Mirrors the bot-harness loop but bounded by the
 * /run-game request's `turns` (capped to MAX_RUN_TURNS) and a hard step cap.
 */
function runGame(req: RunGameRequestBody): RunGameResponseBody {
  const meta: GameMeta = {
    engineVersion: GAME_VERSION,
    forgeSha: "headless-server",
    cardDataSyncedAt: "1970-01-01T00:00:00Z",
    crVersion: "unknown",
    seed: `0x${req.seed.toString(16)}`,
  };
  const game = new Game({
    lobbyPlayers: [
      { id: "alice", name: "Alice", controllerKind: "ai" },
      { id: "bob", name: "Bob", controllerKind: "ai" },
    ],
    rules: RULES,
    meta,
    rng: new SeededRng(req.seed),
  });
  const decks = seedDecks(game);

  // Independent per-seat RNG branches so per-seat decision streams diverge.
  const rngSeat0 = new SeededRng(req.seed ^ 0xa11ce_5eedn);
  const rngSeat1 = new SeededRng(req.seed ^ 0xb0b_5eed_2n);
  const controllers = new Map<PlayerSeat, RandomLegalController>([
    [mkPlayerSeat(0), new RandomLegalController(rngSeat0)],
    [mkPlayerSeat(1), new RandomLegalController(rngSeat1)],
  ]);

  const events: GameEvent[] = [];
  let stepCount = 0;
  let capped = false;

  // ---- setup phase -------------------------------------------------------
  const setupGen = setupGame(game, { decks });
  let setupStep = setupGen.next();
  while (!setupStep.done) {
    stepCount++;
    if (stepCount > MAX_RUN_STEPS) {
      capped = true;
      break;
    }
    if (setupStep.value.kind === "decision") {
      const r: DecisionRequest = setupStep.value.request;
      if (!("playerSeat" in r)) {
        throw new Error(`run-game: setup yielded non-seat request kind=${r.kind}`);
      }
      const c = controllers.get(r.playerSeat);
      if (!c) throw new Error(`run-game: no controller for seat ${r.playerSeat as unknown as number}`);
      const resp: DecisionResponse = c.decide(r);
      setupStep = setupGen.next(resp);
    } else {
      events.push(setupStep.value.event);
      setupStep = setupGen.next();
    }
  }

  // ---- main turn loop ----------------------------------------------------
  if (!capped && !game.isTerminal()) {
    const phaseHandler = new PhaseHandler(game);
    for (let t = 0; t < req.turns; t++) {
      phaseHandler.turnQueue.push({ activePlayer: mkPlayerSeat(t % 2), isExtra: false });
    }
    const phaseGen = phaseHandler.run();
    let phaseStep = phaseGen.next();
    while (!phaseStep.done) {
      stepCount++;
      if (stepCount > MAX_RUN_STEPS) {
        capped = true;
        break;
      }
      if (phaseStep.value.kind === "decision") {
        const r: DecisionRequest = phaseStep.value.request;
        if (!("playerSeat" in r)) {
          throw new Error(`run-game: run yielded non-seat request kind=${r.kind}`);
        }
        const c = controllers.get(r.playerSeat);
        if (!c) throw new Error(`run-game: no controller for seat ${r.playerSeat as unknown as number}`);
        const resp: DecisionResponse = c.decide(r);
        phaseStep = phaseGen.next(resp);
      } else {
        events.push(phaseStep.value.event);
        phaseStep = phaseGen.next();
      }
    }
  }

  // ---- summarise ---------------------------------------------------------
  const turnsStarted = events.filter((e) => e.kind === "TurnStarted").length;
  const terminal = game.isTerminal();
  let winnerSeat: number | null = null;
  let endReason: string | null = null;
  if (terminal && game.terminalState) {
    const outcome = game.terminalState.outcome;
    if (outcome.kind === "win") {
      winnerSeat = outcome.winner as unknown as number;
      endReason = outcome.reason;
    } else if (outcome.kind === "draw") {
      endReason = `draw: ${outcome.reason}`;
    }
  }

  return {
    events: events.map((e) => normaliseForJson(e)),
    summary: {
      turnsStarted,
      totalEvents: events.length,
      stepCount,
      terminal,
      winnerSeat,
      endReason,
      capped,
    },
  };
}

// ---------------------------------------------------------------------------
// JSON normalisation — Map / Set / BigInt are not natively serialisable.
// We walk the tree once and re-shape them; cycles are guarded with a WeakSet.
// ---------------------------------------------------------------------------

function normaliseForJson(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === "bigint") return (v as bigint).toString();
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "function" || t === "symbol") return undefined;
    // objects from here on
    const obj = v as object;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of v.entries()) {
        out[String(k)] = walk(val);
      }
      return out;
    }
    if (v instanceof Set) {
      return Array.from(v.values(), walk);
    }
    // plain-ish object — copy enumerable own keys
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const w = walk(val);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  return walk(value);
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  // Strip query string — none of our endpoints take query params, but a stray
  // `?foo=bar` shouldn't break routing.
  const path = (req.url ?? "/").split("?", 1)[0] ?? "/";

  if (method === "GET" && path === "/health") {
    handleHealth(res);
    return;
  }

  if (method === "POST" && path === "/parse-card") {
    const body = await readJson(req);
    handleParseCard(body, res);
    return;
  }

  if (method === "POST" && path === "/validate-deck") {
    const body = await readJson(req);
    handleValidateDeck(body, res);
    return;
  }

  if (method === "POST" && path === "/run-game") {
    const body = await readJson(req);
    handleRunGame(body, res);
    return;
  }

  sendError(res, 404, `no route for ${method} ${path}`);
}

// ---------------------------------------------------------------------------
// server entry
// ---------------------------------------------------------------------------

function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`PORT must be an integer in [0, 65535], got '${raw}'`);
  }
  return n;
}

export function createApp() {
  return createServer((req, res) => {
    // Catch-all so a thrown error never tears down the server. This wraps both
    // the readJson() reject path and any synchronous handler throw.
    void route(req, res).catch((err: Error) => {
      if (!res.headersSent) {
        sendError(res, 400, "request handling failed", err.message);
      } else {
        try {
          res.end();
        } catch {
          /* socket already closed */
        }
      }
    });
  });
}

function main(): void {
  const port = resolvePort();
  const server = createApp();
  server.listen(port, () => {
    process.stdout.write(
      `mtg-forge-ts-headless-server — engine ${GAME_VERSION} listening on http://127.0.0.1:${port}\n`,
    );
    process.stdout.write("  GET  /health         POST /parse-card   POST /validate-deck   POST /run-game\n");
  });
  // Graceful shutdown on SIGINT/SIGTERM so `pnpm dev` Ctrl-C exits cleanly.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
    });
  }
}

// Run main() unconditionally when this file is executed directly (the only
// supported invocation modes are `pnpm dev` / `node dist/index.js`). Consumers
// that want to embed the router can import `createApp` instead — main() never
// runs in that case because the import simply re-evaluates the module without
// argv pointing at this file. We use a defensive argv check rather than the
// fragile import.meta.url path comparison.
const invokedDirectly =
  process.argv[1] !== undefined &&
  /headless-server[\\/](src[\\/]index\.ts|dist[\\/]index\.js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main();
}

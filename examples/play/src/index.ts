#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// mtg-forge-ts-play — interactive Human vs AI CLI.
//
// What it does:
//   - Builds two 15-card decks of REAL cards (Mountain, Forest, Lightning Bolt,
//     Grizzly Bears) by parsing inline Forge-format scripts via parseCard from
//     @mtg-forge-ts/cards. Each Card gets activateAbilitiesFromDefinition() so
//     the engine sees real spell/mana abilities — not stubs.
//   - Drives the engine's setupGame + PhaseHandler.run() generators manually.
//     For seat-0 decisions (the human) we pause, render the board, prompt via
//     node:readline, parse the answer into a DecisionResponse and resume. For
//     seat-1 decisions (the AI) we delegate to RandomLegalController.
//   - Renders the board after each event-burst so the human sees state changes
//     between their decision windows.
//
// Why a custom driver loop:
//   PlayerController.decide is sync — it cannot await readline. The ergonomic
//   way to plug an async UI into a sync engine is to drive the suspendable
//   generator yourself: each yielded EngineYield can be inspected and the
//   response fed back via gen.next(response). For seat 0 decisions we resolve
//   the response from an async user prompt before calling next(); for seat 1
//   we synchronously consult the controller. HumanController exists for
//   consumers who DO have a sync UI bridge (e.g. an Electron preload that
//   blocks on a native modal); for terminal readline the inline pattern is
//   cleaner and avoids the indirection of an unused callback.

import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline";
import { parseCard } from "@mtg-forge-ts/cards";
import type {
  DecisionRequest,
  DecisionResponse,
  EntityId,
  GameEvent,
  PaperCard,
  PlayerSeat,
  PriorityAction,
} from "@mtg-forge-ts/core";
import { CardType, DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import {
  Card,
  GAME_VERSION,
  Game,
  PhaseHandler,
  RandomLegalController,
  enumerateLegalActions,
  resolveStackItem,
  setupGame,
} from "@mtg-forge-ts/game";
import type { EngineYield, GameMeta, GameRules, SetupDecks } from "@mtg-forge-ts/game";

// ---------------------------------------------------------------------------
// Line reader — node:readline/promises has well-known issues with piped stdin
// (the second .question() call can hang silently because the underlying
// Interface buffers one line at a time and reuses the SIGINT/close handler
// across calls in a way that aborts subsequent reads on a non-TTY input).
// We use the classic event-based interface and our own promise queue so
// piped scripted runs (`yes pass | node ...`) and interactive TTY runs both
// work the same way.
// ---------------------------------------------------------------------------

class LineReader {
  private readonly rl: readline.Interface;
  private readonly queue: string[] = [];
  private waiters: Array<(value: string) => void> = [];
  private closed = false;

  constructor() {
    this.rl = readline.createInterface({ input, terminal: false });
    this.rl.on("line", (line: string) => {
      const w = this.waiters.shift();
      if (w) w(line);
      else this.queue.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      // Flush any pending waiters with a sentinel — empty string represents
      // "end of input"; consumers treat this as "pass" via the default branch.
      while (this.waiters.length > 0) {
        const w = this.waiters.shift();
        if (w) w("");
      }
    });
  }

  async question(prompt: string): Promise<string> {
    output.write(prompt);
    if (this.queue.length > 0) {
      const line = this.queue.shift();
      return line ?? "";
    }
    if (this.closed) return "";
    return new Promise<string>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.rl.close();
  }
}

// ---------------------------------------------------------------------------
// ANSI helpers — bright minimal palette. Disabled if NO_COLOR is set.
// ---------------------------------------------------------------------------

const NO_COLOR = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
const ansi = (code: string, s: string): string => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const dim = (s: string) => ansi("2", s);
const bold = (s: string) => ansi("1", s);
const red = (s: string) => ansi("31", s);
const green = (s: string) => ansi("32", s);
const yellow = (s: string) => ansi("33", s);
const cyan = (s: string) => ansi("36", s);
const magenta = (s: string) => ansi("35", s);

const lifeColor = (life: number): string => {
  if (life <= 5) return red(String(life));
  if (life <= 10) return yellow(String(life));
  return green(String(life));
};

// ---------------------------------------------------------------------------
// Card scripts — real Forge-format card text. parseCard(...) → CardDefinition.
// ---------------------------------------------------------------------------

const MOUNTAIN_SRC = `${[
  "Name:Mountain",
  "Types:Basic Land Mountain",
  "A:AB$ Mana | Cost$ T | Produced$ R | SpellDescription$ Add {R}.",
  "Oracle:({T}: Add {R}.)",
].join("\n")}\n`;

const FOREST_SRC = `${[
  "Name:Forest",
  "Types:Basic Land Forest",
  "A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.",
  "Oracle:({T}: Add {G}.)",
].join("\n")}\n`;

const LIGHTNING_BOLT_SRC = `${[
  "Name:Lightning Bolt",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
  "Oracle:Lightning Bolt deals 3 damage to any target.",
].join("\n")}\n`;

const GRIZZLY_BEARS_SRC = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:(Vanilla bear.)",
].join("\n")}\n`;

interface CardEntry {
  readonly source: string;
  readonly file: string;
  readonly edition: string;
  readonly collectorNumber: string;
}

const HUMAN_DECK: ReadonlyArray<CardEntry> = [
  // 4 Mountains for Lightning Bolt (R) and 4 Forests for Grizzly Bears (1G).
  // The mixed mana base lets you actually cast everything in your deck.
  ...Array.from({ length: 4 }, (_, i) => ({
    source: MOUNTAIN_SRC,
    file: "mountain.txt",
    edition: "PLY",
    collectorNumber: `M${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    source: FOREST_SRC,
    file: "forest.txt",
    edition: "PLY",
    collectorNumber: `F${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    source: LIGHTNING_BOLT_SRC,
    file: "lightning_bolt.txt",
    edition: "PLY",
    collectorNumber: `B${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    source: GRIZZLY_BEARS_SRC,
    file: "grizzly_bears.txt",
    edition: "PLY",
    collectorNumber: `G${String(i + 1).padStart(2, "0")}`,
  })),
];

const AI_DECK: ReadonlyArray<CardEntry> = [
  // Mirror the human's mana base — 4 Mountains + 4 Forests so the AI can
  // also cast both Lightning Bolt (R) and Grizzly Bears (1G).
  ...Array.from({ length: 4 }, (_, i) => ({
    source: MOUNTAIN_SRC,
    file: "mountain.txt",
    edition: "PLY",
    collectorNumber: `M${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    source: FOREST_SRC,
    file: "forest.txt",
    edition: "PLY",
    collectorNumber: `F${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    source: LIGHTNING_BOLT_SRC,
    file: "lightning_bolt.txt",
    edition: "PLY",
    collectorNumber: `B${String(i + 1).padStart(2, "0")}`,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    source: GRIZZLY_BEARS_SRC,
    file: "grizzly_bears.txt",
    edition: "PLY",
    collectorNumber: `G${String(i + 1).padStart(2, "0")}`,
  })),
];

// ---------------------------------------------------------------------------
// Game construction
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
  forgeSha: "play",
  cardDataSyncedAt: "1970-01-01T00:00:00Z",
  crVersion: "unknown",
  seed: "0xPLAY",
};

function buildPaper(entry: CardEntry): PaperCard {
  const def = parseCard(entry.source, entry.file);
  return {
    name: def.name,
    edition: entry.edition,
    collectorNumber: entry.collectorNumber,
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
}

function seedDeck(game: Game, deck: ReadonlyArray<CardEntry>, seat: PlayerSeat): EntityId[] {
  const ids: EntityId[] = [];
  for (const entry of deck) {
    const id = game.newEntityId();
    const paper = buildPaper(entry);
    const card = new Card(id, paper, seat, seat, ZoneType.Library);
    // Activate intrinsic abilities so the engine sees real mana abilities
    // (Mountain/Forest) and real spell abilities (Lightning Bolt). Without
    // this hand-off the cast pipeline would treat every card as a no-op
    // shell.
    card.activateAbilitiesFromDefinition();
    game.cards.set(id, card);
    ids.push(id);
  }
  return ids;
}

function buildGame(seed: bigint): { game: Game; decks: SetupDecks } {
  const game = new Game({
    lobbyPlayers: [
      { id: "human", name: "You", controllerKind: "human" },
      { id: "ai", name: "Opp", controllerKind: "ai" },
    ],
    rules: RULES,
    meta: META,
    rng: new SeededRng(seed),
  });
  const seat0 = mkPlayerSeat(0);
  const seat1 = mkPlayerSeat(1);
  const humanIds = seedDeck(game, HUMAN_DECK, seat0);
  const aiIds = seedDeck(game, AI_DECK, seat1);
  const decks = { 0: humanIds, 1: aiIds } as unknown as SetupDecks;
  return { game, decks };
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------

function cardLabel(game: Game, id: EntityId): string {
  const card = game.cards.get(id);
  if (!card) return `?${String(id)}`;
  const name = card.paperCard.name;
  const def = card.paperCard.definition;
  const types: ReadonlyArray<string> = (def?.types?.types ?? []) as ReadonlyArray<string>;
  const isCreature = types.includes(CardType.Creature);
  if (isCreature) {
    const pt = def?.pt ? `${def.pt.power}/${def.pt.toughness}` : "?/?";
    const dmg = card.damage > 0 ? ` -${card.damage}` : "";
    return `${name} (${pt}${dmg})`;
  }
  return name;
}

function tapMarker(game: Game, id: EntityId): string {
  return game.cards.get(id)?.tapped ? dim(" T") : "";
}

function manaPoolStr(game: Game, seat: PlayerSeat): string {
  const player = game.getPlayer(seat);
  // Player.manaPool is typed `unknown` in the engine (Task 36 placeholder
  // resolution still pending); narrow defensively to the live ManaPool API.
  const poolRaw = player.manaPool as { toArray?: () => ReadonlyArray<{ color?: string | null }> } | null;
  if (!poolRaw || typeof poolRaw.toArray !== "function") return dim("(empty)");
  const pool = poolRaw.toArray();
  if (pool.length === 0) return dim("(empty)");
  const counts: Record<string, number> = {};
  for (const m of pool) {
    const key = (m.color ?? "C") as string;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v}${k}`)
    .join(" ");
}

function zoneIds(game: Game, seat: PlayerSeat, zone: ZoneType): EntityId[] {
  return game.getPlayer(seat).zones.get(zone)?.toArray() ?? [];
}

function zoneSize(game: Game, seat: PlayerSeat, zone: ZoneType): number {
  return game.getPlayer(seat).zones.get(zone)?.size ?? 0;
}

function renderBoard(game: Game, currentTurn: number, currentPhase: string): string {
  const seat0 = mkPlayerSeat(0);
  const seat1 = mkPlayerSeat(1);
  const you = game.getPlayer(seat0);
  const opp = game.getPlayer(seat1);
  const lines: string[] = [];

  const activeIs0 = game.activePlayer === seat0;
  const turnLabel = activeIs0 ? bold(green("Your turn")) : bold(red("Opp's turn"));
  lines.push("");
  lines.push(cyan(`=== Turn ${currentTurn} (${currentPhase}) — ${turnLabel} ===`));

  lines.push(
    `${red("Opp")}: ${lifeColor(opp.life)} life | hand=${zoneSize(game, seat1, ZoneType.Hand)} | ` +
      `library=${zoneSize(game, seat1, ZoneType.Library)} | gy=${zoneSize(game, seat1, ZoneType.Graveyard)} | ` +
      `mana=${manaPoolStr(game, seat1)}`,
  );
  lines.push(
    `${green("You")}: ${lifeColor(you.life)} life | hand=${zoneSize(game, seat0, ZoneType.Hand)} | ` +
      `library=${zoneSize(game, seat0, ZoneType.Library)} | gy=${zoneSize(game, seat0, ZoneType.Graveyard)} | ` +
      `mana=${manaPoolStr(game, seat0)}`,
  );

  // Opp's battlefield
  const oppBf = zoneIds(game, seat1, ZoneType.Battlefield);
  lines.push("");
  lines.push(red("Opp's battlefield:"));
  if (oppBf.length === 0) {
    lines.push(dim("  (empty)"));
  } else {
    oppBf.forEach((id, i) => {
      lines.push(`  [${magenta(`O${i + 1}`)}] ${cardLabel(game, id)}${tapMarker(game, id)}`);
    });
  }

  // Your battlefield
  const youBf = zoneIds(game, seat0, ZoneType.Battlefield);
  lines.push("");
  lines.push(green("Your battlefield:"));
  if (youBf.length === 0) {
    lines.push(dim("  (empty)"));
  } else {
    youBf.forEach((id, i) => {
      lines.push(`  [${magenta(`Y${i + 1}`)}] ${cardLabel(game, id)}${tapMarker(game, id)}`);
    });
  }

  // Your hand
  const youH = zoneIds(game, seat0, ZoneType.Hand);
  lines.push("");
  lines.push(green("Your hand:"));
  if (youH.length === 0) {
    lines.push(dim("  (empty)"));
  } else {
    youH.forEach((id, i) => {
      lines.push(`  [${magenta(`H${i + 1}`)}] ${cardLabel(game, id)}`);
    });
  }

  // Stack
  const stack = game.sharedZones.stack.toArray();
  lines.push("");
  if (stack.length === 0) {
    lines.push(`Stack: ${dim("empty")}`);
  } else {
    lines.push("Stack:");
    stack.forEach((item, i) => {
      const sourceCard = game.cards.get(item.sourceCardId);
      const name = sourceCard?.paperCard.name ?? "?";
      lines.push(`  [${i + 1}] ${name}`);
    });
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Event log buffering — we accumulate "interesting" events between decisions
// and dump them as a digest after rendering the board. This keeps the user
// from drowning in PriorityGranted spam.
// ---------------------------------------------------------------------------

function describeEvent(game: Game, event: GameEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  const seat0 = mkPlayerSeat(0);
  switch (event.kind) {
    case "TurnStarted": {
      const seat = payload.activeSeat as PlayerSeat;
      const who = seat === seat0 ? "You" : "Opp";
      return cyan(`-- Turn ${event.turn}: ${who}'s turn begins --`);
    }
    case "CardDrawn": {
      const seat = payload.playerSeat as PlayerSeat | undefined;
      const isYou = seat === seat0;
      return dim(isYou ? "  · You draw a card." : "  · Opp draws a card.");
    }
    case "LandPlayed": {
      const seat = payload.playerSeat as PlayerSeat | undefined;
      const cardId = payload.cardId as EntityId | undefined;
      const name = cardId !== undefined ? (game.cards.get(cardId)?.paperCard.name ?? "?") : "?";
      const who = seat === seat0 ? "You" : "Opp";
      return `  · ${who} played ${name}.`;
    }
    case "CardChangedZone": {
      const cardId = payload.cardId as EntityId;
      const name = game.cards.get(cardId)?.paperCard.name ?? "?";
      const from = String(payload.fromZone);
      const to = String(payload.toZone);
      // Only surface "interesting" zone moves — avoid showing every library
      // shuffle / hand-shuffle internal motion.
      if (from === to) return null;
      return dim(`  · ${name}: ${from} → ${to}`);
    }
    case "SpellCast":
    case "SpellPutOnStack": {
      const cardId = payload.cardId as EntityId | undefined;
      const name = cardId !== undefined ? (game.cards.get(cardId)?.paperCard.name ?? "?") : "?";
      return cyan(`  > ${name} put on the stack.`);
    }
    case "StackItemResolved": {
      const cardId = payload.cardId as EntityId | undefined;
      const name = cardId !== undefined ? (game.cards.get(cardId)?.paperCard.name ?? "?") : "spell";
      return cyan(`  < ${name} resolved.`);
    }
    case "DamageDealt": {
      const sourceId = payload.sourceId as EntityId;
      const targetKind = payload.targetKind as string;
      const targetIdRaw = payload.targetId as EntityId | PlayerSeat;
      const amount = payload.amount as number;
      const sourceName = game.cards.get(sourceId)?.paperCard.name ?? "?";
      let targetLabel = "?";
      if (targetKind === "player") {
        targetLabel = (targetIdRaw as unknown) === (seat0 as unknown) ? "You" : "Opp";
      } else {
        targetLabel = game.cards.get(targetIdRaw as EntityId)?.paperCard.name ?? "?";
      }
      return red(`  ! ${sourceName} deals ${amount} damage to ${targetLabel}.`);
    }
    case "PlayerLifeChanged":
    case "LifeChanged": {
      const seat = payload.playerSeat as PlayerSeat | undefined;
      const newLife = payload.newLife;
      const who = seat === seat0 ? "You" : "Opp";
      return `  · ${who} life → ${String(newLife)}.`;
    }
    case "CardTapped": {
      const cardId = payload.cardId as EntityId;
      const name = game.cards.get(cardId)?.paperCard.name ?? "?";
      return dim(`  · ${name} tapped.`);
    }
    case "AttackersDeclared":
      return red("  >>> attackers declared.");
    case "GameEnded":
    case "PlayerLost":
    case "PlayerWon":
    case "PlayerConceded":
      return bold(yellow(`  *** ${event.kind}.`));
    case "CardSacrificed":
    case "CardDestroyed":
    case "CardExiled": {
      const cardId = payload.cardId as EntityId;
      const name = game.cards.get(cardId)?.paperCard.name ?? "?";
      return red(`  · ${name} ${event.kind.toLowerCase().replace("card", "")}.`);
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Driver state + IO helpers
// ---------------------------------------------------------------------------

interface DriverState {
  readonly rl: LineReader;
  readonly game: Game;
  readonly aiController: RandomLegalController;
  pendingEvents: GameEvent[];
  lastTurn: number;
  lastPhase: string;
  quit: boolean;
}

function flushEvents(state: DriverState): void {
  if (state.pendingEvents.length === 0) return;
  const lines: string[] = [];
  for (const ev of state.pendingEvents) {
    state.lastTurn = ev.turn ?? state.lastTurn;
    state.lastPhase = (ev.phase ?? state.lastPhase) as string;
    if (ev.kind === "PhaseStarted" || ev.kind === "StepStarted") {
      const p = ev.payload as { phase?: string; step?: string };
      state.lastPhase = (p.step ?? p.phase ?? state.lastPhase) as string;
    }
    const line = describeEvent(state.game, ev);
    if (line) lines.push(line);
  }
  if (lines.length > 0) {
    output.write(`${lines.join("\n")}\n`);
  }
  state.pendingEvents = [];
}

async function promptIndices(
  state: DriverState,
  prompt: string,
  max: number,
  min: number,
  cap: number,
): Promise<number[]> {
  while (true) {
    const ans = (await state.rl.question(prompt)).trim();
    if (ans === "" && min === 0) return [];
    const parts = ans.split(/[\s,]+/).filter((x) => x.length > 0);
    const nums = parts.map((p) => Number(p));
    if (
      nums.every((n) => Number.isInteger(n) && n >= 1 && n <= max) &&
      nums.length >= min &&
      nums.length <= cap
    ) {
      return nums.map((n) => n - 1);
    }
    output.write(red(`  ! Invalid input. Enter ${min}..${cap} indices in 1..${max}.\n`));
  }
}

/**
 * Resolve a hand-letter token ("H2") or battlefield index ("Y3" / "O1") into
 * the corresponding EntityId, or null if the token doesn't match anything.
 */
function resolveToken(game: Game, token: string): EntityId | null {
  const m = /^([HYO])(\d+)$/i.exec(token);
  if (!m) return null;
  const tag = m[1]?.toUpperCase();
  const idxRaw = m[2];
  if (!tag || !idxRaw) return null;
  const idx = Number(idxRaw) - 1;
  const seat0 = mkPlayerSeat(0);
  const seat1 = mkPlayerSeat(1);
  let ids: EntityId[] = [];
  if (tag === "H") {
    ids = zoneIds(game, seat0, ZoneType.Hand);
  } else if (tag === "Y") {
    ids = zoneIds(game, seat0, ZoneType.Battlefield);
  } else if (tag === "O") {
    ids = zoneIds(game, seat1, ZoneType.Battlefield);
  }
  return ids[idx] ?? null;
}

// ---------------------------------------------------------------------------
// Decision handlers
// ---------------------------------------------------------------------------

async function handleHumanMulligan(
  state: DriverState,
  req: { kind: "mulligan"; playerSeat: PlayerSeat; currentHand: readonly EntityId[]; mulligansSoFar: number },
): Promise<DecisionResponse> {
  const handCards = req.currentHand.map((id) => state.game.cards.get(id)?.paperCard.name ?? "?");
  output.write("\n=== Mulligan decision ===\n");
  output.write(`Opening hand (${handCards.length} cards, ${req.mulligansSoFar} mulligans so far):\n`);
  for (let i = 0; i < handCards.length; i++) {
    output.write(`  [${i + 1}] ${handCards[i]}\n`);
  }
  output.write(
    dim(
      "  London mulligan: keep = play this hand. mull = shuffle + redraw 7 (cost: scry-N to bottom on keep).\n",
    ),
  );
  while (true) {
    const ans = (await state.rl.question(bold("Mulligan? [keep/mull]: "))).trim().toLowerCase();
    if (ans === "" || ans === "keep" || ans === "k") {
      output.write(dim("  → keep\n"));
      return { kind: "mulligan", keep: true };
    }
    if (ans === "mull" || ans === "m" || ans === "mulligan") {
      output.write(dim("  → mulligan\n"));
      return { kind: "mulligan", keep: false };
    }
    output.write(red("  ! type 'keep' or 'mull'.\n"));
  }
}

async function handleHumanPriority(
  state: DriverState,
  legal: ReadonlyArray<PriorityAction>,
): Promise<DecisionResponse> {
  output.write(`\n${renderBoard(state.game, state.lastTurn, state.lastPhase)}\n`);
  // The current SP1 PhaseHandler emits a "minimal" priority window with only
  // {pass, concede} in the request — it does NOT yet route through the full
  // priority-orchestrator that enumerates castable spells / playable lands.
  // To still let the user act, we ALSO query enumerateLegalActions ourselves
  // and present the broader list. When the user picks a non-pass/concede
  // action we drive the appropriate game.action / castPipeline generator
  // directly to execute it BEFORE returning "pass" to the engine; this
  // hijacks the priority window so the user gets real interactivity even
  // before the engine wires the priority orchestrator into PhaseHandler.
  const broader = enumerateLegalActions(state.game, mkPlayerSeat(0));
  // Merge: keep pass/concede from the engine list, add cast/playLand/activate
  // entries from our direct enumeration. (In practice `legal` is exactly
  // [pass, concede] here, but we tolerate any future overlap.)
  const merged: PriorityAction[] = [...legal];
  for (const a of broader) {
    if (a.kind !== "pass" && a.kind !== "concede" && !legal.some((b) => actionsEqual(a, b))) {
      merged.push(a);
    }
  }
  const fullLegal = merged;
  const legalKinds = new Set(fullLegal.map((a) => a.kind));
  const hints: string[] = [];
  if (fullLegal.some((a) => a.kind === "playLand")) hints.push("play <H#>");
  if (fullLegal.some((a) => a.kind === "castSpell")) hints.push("cast <H#>");
  if (hints.length > 0) {
    output.write(dim(`  legal: ${hints.join(" | ")} | pass | concede | help\n`));
    output.write(dim("  (mana auto-taps when you cast; type 'help' for full command list)\n"));
  } else {
    // Quiet phase (Untap/Upkeep/Draw/Combat sub-steps with no creatures, etc.).
    // Most users want to skip through these — surface the reason + suggest pass.
    const phaseName = String(state.lastPhase);
    const handHasLand = zoneIds(state.game, mkPlayerSeat(0), ZoneType.Hand).some((id) => {
      const card = state.game.cards.get(id);
      return card?.paperCard.definition?.types?.types?.includes(CardType.Land) ?? false;
    });
    if (handHasLand && !["Main1", "Main2"].includes(phaseName)) {
      output.write(
        dim(
          `  (You have lands in hand but it's the ${phaseName} step — pass to reach Main1 to play them.)\n`,
        ),
      );
    } else {
      output.write(dim(`  (Nothing castable here — type 'pass' to advance.)\n`));
    }
    output.write(dim("  legal: pass | concede | help\n"));
  }

  while (true) {
    const raw = (await state.rl.question(bold("Your action [pass]: "))).trim();
    if (raw === "" || raw.toLowerCase() === "pass") {
      if (legalKinds.has("pass")) return { kind: "priority", action: { kind: "pass" } };
      output.write(red("  ! pass is not currently legal.\n"));
      continue;
    }
    if (raw.toLowerCase() === "quit") {
      state.quit = true;
      return { kind: "priority", action: { kind: "concede" } };
    }
    if (raw.toLowerCase() === "concede") {
      return { kind: "priority", action: { kind: "concede" } };
    }
    if (raw.toLowerCase() === "help" || raw.toLowerCase() === "?") {
      output.write(dim("\n  --- commands ---\n"));
      output.write(dim("  pass       Pass priority. Lands play in your Main phases (1 land/turn).\n"));
      output.write(dim("  play H#    Play the land at hand index H# (e.g. 'play H2').\n"));
      output.write(dim("  cast H#    Cast the spell at hand index H#. Mana auto-taps from your lands.\n"));
      output.write(dim("  attack     Auto-declare all your creatures attacking.\n"));
      output.write(dim("  concede    Lose immediately.\n"));
      output.write(dim("  quit       Same as concede + exits the program.\n"));
      output.write(dim("  help / ?   Show this list.\n"));
      output.write(dim("\n  Tokens: H# = hand, Y# = your battlefield, O# = opponent's battlefield.\n\n"));
      continue;
    }
    const lower = raw.toLowerCase();

    if (lower.startsWith("play ")) {
      const tok = raw.slice(5).trim();
      const id = resolveToken(state.game, tok);
      if (id === null) {
        output.write(red(`  ! Unknown card token "${tok}". Use H#.\n`));
        continue;
      }
      const match = fullLegal.find((a) => a.kind === "playLand" && a.cardId === id);
      if (!match) {
        output.write(
          red(
            "  ! Cannot play that card right now (not your main phase, stack non-empty, already played a land?).\n",
          ),
        );
        continue;
      }
      // Drive game.action.playLand inline, then re-prompt within the same
      // priority window (the engine has not actually consumed the priority
      // yield yet — we only return when the user passes/concedes).
      try {
        await runActionGenerator(state, state.game.action.playLand(id, mkPlayerSeat(0)));
      } catch (e) {
        output.write(red(`  ! playLand failed: ${(e as Error).message}\n`));
      }
      flushEvents(state);
      output.write(`\n${renderBoard(state.game, state.lastTurn, state.lastPhase)}\n`);
      continue;
    }

    if (lower.startsWith("cast ")) {
      const tok = raw.slice(5).trim();
      const id = resolveToken(state.game, tok);
      if (id === null) {
        output.write(red(`  ! Unknown card token "${tok}".\n`));
        continue;
      }
      const match = fullLegal.find((a) => a.kind === "castSpell" && a.cardId === id);
      if (!match) {
        output.write(red("  ! Cannot cast that card right now (mana? phase? not in hand?).\n"));
        continue;
      }
      try {
        const proposal = {
          castingPlayer: mkPlayerSeat(0),
          sourceCardId: id,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        };
        const stackItem = await runCastGenerator(
          state,
          state.game.castPipeline.run(proposal) as Generator<EngineYield, unknown, unknown>,
        );
        flushEvents(state);
        if (stackItem !== null && stackItem !== undefined) {
          // Resolve the spell off the stack right now. The SP1 priority
          // window doesn't yet route counterspell windows; we resolve
          // directly so the example shows the spell taking effect.
          await runActionGenerator(
            state,
            resolveStackItem(state.game, stackItem as never) as Generator<EngineYield, unknown, unknown>,
          );
          flushEvents(state);
        }
      } catch (e) {
        output.write(red(`  ! cast failed: ${(e as Error).message}\n`));
      }
      output.write(`\n${renderBoard(state.game, state.lastTurn, state.lastPhase)}\n`);
      continue;
    }

    if (lower === "attack") {
      output.write(
        red(`  ! Use 'attack' at the declare-attackers prompt during combat — not at priority.\n`),
      );
      continue;
    }

    output.write(red(`  ! Unknown command "${raw}". Try: pass | play H# | cast H# | concede | quit.\n`));
  }
}

function actionsEqual(a: PriorityAction, b: PriorityAction): boolean {
  if (a.kind !== b.kind) return false;
  if ("cardId" in a && "cardId" in b) return a.cardId === b.cardId;
  return true;
}

/**
 * Drive a generic engine generator (game.action.* or resolveStackItem) to
 * completion, dispatching its decisions through decideHuman / aiController
 * and accumulating its events in driver state.
 */
async function runActionGenerator(
  state: DriverState,
  gen: Generator<EngineYield, unknown, unknown>,
): Promise<void> {
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 50_000) throw new Error("runActionGenerator: 50k step safety abort");
    if (step.value.kind === "decision") {
      const req = step.value.request;
      const isHuman = "playerSeat" in req && req.playerSeat === mkPlayerSeat(0);
      let response: DecisionResponse;
      if (req.kind === "activateManaAbilities") {
        response = { kind: "activateManaAbilities", done: true };
      } else if (isHuman) {
        response = await decideHuman(state, req);
      } else {
        response = state.aiController.decide(req);
      }
      step = gen.next(response);
    } else {
      state.pendingEvents.push(step.value.event);
      step = gen.next();
    }
  }
}

/** Same loop as runActionGenerator but returns the generator's terminal value. */
async function runCastGenerator(
  state: DriverState,
  gen: Generator<EngineYield, unknown, unknown>,
): Promise<unknown> {
  let step = gen.next();
  let safety = 0;
  while (!step.done) {
    safety++;
    if (safety > 50_000) throw new Error("runCastGenerator: 50k step safety abort");
    if (step.value.kind === "decision") {
      const req = step.value.request;
      const isHuman = "playerSeat" in req && req.playerSeat === mkPlayerSeat(0);
      let response: DecisionResponse;
      if (req.kind === "activateManaAbilities") {
        response = { kind: "activateManaAbilities", done: true };
      } else if (isHuman) {
        response = await decideHuman(state, req);
      } else {
        response = state.aiController.decide(req);
      }
      step = gen.next(response);
    } else {
      state.pendingEvents.push(step.value.event);
      step = gen.next();
    }
  }
  return step.value;
}

interface DefenderRef {
  readonly kind: "player" | "planeswalker" | "battle";
  readonly seat?: PlayerSeat;
  readonly id?: EntityId;
}

async function handleHumanDeclareAttackers(
  state: DriverState,
  req: Extract<DecisionRequest, { kind: "declareAttackers" }>,
): Promise<DecisionResponse> {
  output.write(`\n${renderBoard(state.game, state.lastTurn, state.lastPhase)}\n`);
  if (req.legalAttackers.length === 0) {
    output.write(dim("  (no legal attackers — auto-skip)\n"));
    return { kind: "declareAttackers", attackers: [] };
  }
  const labels = req.legalAttackers.map((id) => state.game.cards.get(id)?.paperCard.name ?? "?");
  output.write(`Legal attackers: ${labels.map((n, i) => `${i + 1}.${n}`).join(", ")}\n`);
  const raw = (await state.rl.question(`Attack? [enter=skip / 'all' / space-separated indices]: `))
    .trim()
    .toLowerCase();
  if (raw === "" || raw === "skip" || raw === "no") {
    return { kind: "declareAttackers", attackers: [] };
  }
  // Find a player defender (the opponent).
  const playerDef = (req.legalDefenders as ReadonlyArray<DefenderRef>).find((d) => d.kind === "player");
  if (!playerDef || playerDef.seat === undefined) {
    output.write(red("  ! No player defender available.\n"));
    return { kind: "declareAttackers", attackers: [] };
  }
  const defenderSeat = playerDef.seat;
  let attackerIds: EntityId[];
  if (raw === "all") {
    attackerIds = [...req.legalAttackers];
  } else {
    const parts = raw.split(/[\s,]+/).filter((x) => x.length > 0);
    const nums = parts.map((p) => Number(p));
    if (!nums.every((n) => Number.isInteger(n) && n >= 1 && n <= req.legalAttackers.length)) {
      output.write(red("  ! Bad indices, skipping combat.\n"));
      return { kind: "declareAttackers", attackers: [] };
    }
    attackerIds = nums.map((n) => req.legalAttackers[n - 1]).filter((x): x is EntityId => x !== undefined);
  }
  const attackers = attackerIds.map((id) => ({
    attacker: id,
    defender: { player: defenderSeat },
  }));
  return { kind: "declareAttackers", attackers };
}

async function handleHumanChooseTargets(
  state: DriverState,
  req: Extract<DecisionRequest, { kind: "chooseTargets" }>,
): Promise<DecisionResponse> {
  const sourceName = state.game.cards.get(req.sourceId)?.paperCard.name ?? "?";
  output.write(`\n${bold(`${sourceName} needs ${req.min}..${req.max} target(s):\n`)}`);
  if (req.choicesAllowed.length === 0) {
    return { kind: "chooseTargets", targets: [] };
  }
  req.choicesAllowed.forEach((id, i) => {
    const c = state.game.cards.get(id);
    output.write(`  ${i + 1}. ${c?.paperCard.name ?? "?"}\n`);
  });
  const indices = await promptIndices(
    state,
    `  pick ${req.min}..${req.max}: `,
    req.choicesAllowed.length,
    req.min,
    req.max,
  );
  const targets = indices.map((i) => req.choicesAllowed[i]).filter((x): x is EntityId => x !== undefined);
  return { kind: "chooseTargets", targets };
}

async function handleHumanCastTargets(
  state: DriverState,
  req: Extract<DecisionRequest, { kind: "chooseCastTargets" }>,
): Promise<DecisionResponse> {
  const sourceName = state.game.cards.get(req.sourceId)?.paperCard.name ?? "?";
  output.write(`\n${bold(`${sourceName} needs ${req.min}..${req.max} target(s):\n`)}`);
  type TargetRef =
    | { kind: "card"; id: EntityId }
    | { kind: "player"; seat: PlayerSeat }
    | { kind: "stackItem"; id: EntityId };
  const targets = req.legalTargets as ReadonlyArray<TargetRef>;
  if (targets.length === 0) {
    return { kind: "chooseCastTargets", targets: [] };
  }
  targets.forEach((t, i) => {
    let label = "?";
    if (t.kind === "card") {
      label = state.game.cards.get(t.id)?.paperCard.name ?? "?";
    } else if (t.kind === "player") {
      label = t.seat === mkPlayerSeat(0) ? "You" : "Opp";
    } else if (t.kind === "stackItem") {
      label = `stack[${state.game.cards.get(t.id)?.paperCard.name ?? "?"}]`;
    }
    output.write(`  ${i + 1}. ${label}\n`);
  });
  const indices = await promptIndices(
    state,
    `  pick ${req.min}..${req.max}: `,
    targets.length,
    req.min,
    req.max,
  );
  const picked = indices.map((i) => targets[i]).filter((x): x is TargetRef => x !== undefined);
  return { kind: "chooseCastTargets", targets: picked };
}

async function handleHumanChooseModes(
  state: DriverState,
  req: Extract<DecisionRequest, { kind: "chooseModes" }>,
): Promise<DecisionResponse> {
  output.write(`\n${bold(`Choose ${req.min}..${req.max} mode(s):\n`)}`);
  req.modes.forEach((m, i) => output.write(`  ${i + 1}. ${m.description}\n`));
  const indices = await promptIndices(state, "  pick: ", req.modes.length, req.min, req.max);
  const ids = indices.map((i) => req.modes[i]?.id).filter((x): x is string => x !== undefined);
  return { kind: "chooseModes", modeIds: ids };
}

async function handleHumanChooseX(
  state: DriverState,
  req: Extract<DecisionRequest, { kind: "chooseX" }>,
): Promise<DecisionResponse> {
  output.write(`\n${bold(`Choose X (0..${req.maxX}):\n`)}`);
  while (true) {
    const ans = (await state.rl.question("  X = ")).trim();
    const x = Number(ans);
    if (Number.isInteger(x) && x >= 0 && x <= req.maxX) {
      return { kind: "chooseX", x };
    }
    output.write(red(`  ! invalid X (need 0..${req.maxX}).\n`));
  }
}

/**
 * Fallback: for decisions we don't bother building a UI for, just delegate to
 * the AI's RandomLegalController. This keeps the driver complete without
 * forcing the user to mash through every micro-decision.
 */
function aiFallback(state: DriverState, req: DecisionRequest): DecisionResponse {
  return state.aiController.decide(req);
}

async function decideHuman(state: DriverState, req: DecisionRequest): Promise<DecisionResponse> {
  flushEvents(state);
  switch (req.kind) {
    case "priority":
      return handleHumanPriority(state, req.legalActions);
    case "declareAttackers":
      return handleHumanDeclareAttackers(state, req);
    case "declareBlockers":
      output.write(dim("  (auto-skipping blockers)\n"));
      return { kind: "declareBlockers", blocks: [] };
    case "chooseTargets":
      return handleHumanChooseTargets(state, req);
    case "chooseCastTargets":
      return handleHumanCastTargets(state, req);
    case "chooseModes":
      return handleHumanChooseModes(state, req);
    case "chooseX":
      return handleHumanChooseX(state, req);
    case "mulligan":
      return await handleHumanMulligan(state, req);
    default:
      return aiFallback(state, req);
  }
}

// ---------------------------------------------------------------------------
// Main driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  output.write(
    bold(cyan("\n  __  __ _____ ____    _____ ___  ____   ____ _____ \n")) +
      bold(cyan(" |  \\/  |_   _/ ___|  |  ___/ _ \\|  _ \\ / ___| ____|\n")) +
      bold(cyan(" | |\\/| | | || |  _   | |_ | | | | |_) | |  _|  _|  \n")) +
      bold(cyan(" | |  | | | || |_| |  |  _|| |_| |  _ <| |_| | |___ \n")) +
      bold(cyan(" |_|  |_| |_| \\____|  |_|   \\___/|_| \\_\\\\____|_____|\n")) +
      dim(`         interactive play CLI · engine ${GAME_VERSION}\n\n`),
  );
  output.write(dim("Type 'pass' / [enter] to pass priority. 'quit' exits.\n\n"));

  const seed = BigInt(0xb0_71234);
  const { game, decks } = buildGame(seed);

  const aiController = new RandomLegalController(new SeededRng(seed ^ 0xa11ce_5eedn));
  const rl = new LineReader();

  const state: DriverState = {
    rl,
    game,
    aiController,
    pendingEvents: [],
    lastTurn: 0,
    lastPhase: "—",
    quit: false,
  };

  // Pin the human (seat 0) as the starting player. setupGame's default rolls
  // a random first player; combined with the turn-queue seeding below
  // (which hardcodes seat 0 as the first turn) this would mismatch and the
  // CR 103.7c "first player skips draw" rule wouldn't apply to seat 0 (the
  // engine compares game.startingPlayer against the active turn's seat —
  // both must be 0 for the skip).
  game.startingPlayer = mkPlayerSeat(0);

  // Drive setupGame manually — same shape as runGame but we control the
  // turn queue afterwards so the match runs many turns instead of just two.
  const setupGen = setupGame(game, { decks });
  let setupStep = setupGen.next();
  while (!setupStep.done) {
    if (setupStep.value.kind === "decision") {
      const req = setupStep.value.request;
      let response: DecisionResponse;
      if ("playerSeat" in req && req.playerSeat === mkPlayerSeat(0)) {
        response = await decideHuman(state, req);
        if (state.quit) {
          rl.close();
          return;
        }
      } else {
        response = aiController.decide(req);
      }
      setupStep = setupGen.next(response);
    } else {
      state.pendingEvents.push(setupStep.value.event);
      setupStep = setupGen.next();
    }
  }

  if (game.isTerminal()) {
    flushEvents(state);
    output.write(yellow("\nGame ended during setup.\n"));
    rl.close();
    return;
  }

  // Seed 25 turns alternating between seats so the match plays out — runGame
  // would only seed 2 (one per seat) and end after a single round-trip.
  const phaseHandler = new PhaseHandler(game);
  for (let t = 0; t < 25; t++) {
    phaseHandler.turnQueue.push({ activePlayer: mkPlayerSeat(t % 2), isExtra: false });
  }
  flushEvents(state);

  const phaseGen = phaseHandler.run();
  let step: IteratorResult<EngineYield, void> = phaseGen.next();
  let safetyCounter = 0;
  while (!step.done) {
    safetyCounter++;
    if (safetyCounter > 500_000) {
      output.write(red("\n[safety abort: 500k generator steps without termination]\n"));
      break;
    }
    if (step.value.kind === "decision") {
      const req = step.value.request;
      let response: DecisionResponse;
      const isHuman = "playerSeat" in req && req.playerSeat === mkPlayerSeat(0);
      if (isHuman) {
        response = await decideHuman(state, req);
        if (state.quit) {
          output.write(yellow("\nQuitting at user request. Bye!\n"));
          rl.close();
          return;
        }
      } else {
        response = aiController.decide(req);
      }
      step = phaseGen.next(response);
    } else {
      state.pendingEvents.push(step.value.event);
      step = phaseGen.next();
    }
  }

  flushEvents(state);
  output.write(`\n${bold(yellow("=== Game over ===\n"))}`);
  if (game.isTerminal() && game.terminalState) {
    const out = game.terminalState.outcome;
    if (out.kind === "win") {
      const winnerSeat = out.winner as unknown as number;
      const youWon = winnerSeat === 0;
      output.write(youWon ? green("You win!\n") : red("Opp wins.\n"));
      output.write(dim(`Reason: ${out.reason}\n`));
    } else if (out.kind === "draw") {
      output.write(yellow(`Draw: ${out.reason}\n`));
    }
  } else {
    output.write(dim("Turn queue exhausted without a terminal state.\n"));
  }
  rl.close();
}

main().catch((err) => {
  process.stderr.write(`\n[fatal] ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});

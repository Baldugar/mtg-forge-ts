// SPDX-License-Identifier: GPL-3.0-or-later
// F13 — Cycling flagship test (Forgotten Cave).
//
// Cycling: {R}, Discard this card — Draw a card.
// K:Cycling:R parsed as { keyword: "cycling", params: { cost: { kind: "literal", raw: "R" } } }
//
// Test scenario (end-to-end):
//   1. Build a Forgotten Cave card with K:Cycling:R in hand.
//   2. Call activateKeywordsFromDefinition → CyclingKeywordHandler synthesizes
//      a SpellAbility with activeInZones={Hand}, handlerKey="Draw",
//      cost="R, Discard CARDNAME".
//   3. Seed R mana in the controller's pool.
//   4. Place a dummy card in the library (so drawCards has something to draw).
//   5. Find the cycling ability index (the one with activeInZones={Hand}).
//   6. Call game.action.activateAbility(cardId, cyclingIndex, seat).
//      — Pays R (mana pool drained).
//      — Pays CostDiscard (Forgotten Cave moves to graveyard).
//      — Pushes a Draw-1 StackItem onto the stack.
//   7. Resolve the stack item → controller draws 1 card.
//   8. Assert:
//      - Forgotten Cave is now in graveyard.
//      - Mana pool is empty (R spent).
//      - Controller's hand has the dummy card.
//      - Stack is empty after resolution.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// --- Bootstrap registries ---
// Cost parts: CostMana, CostDiscard, etc.
import "../../src/cost/parts/index.js";
// Effects: DrawEffect, etc.
import "../../src/ability/effects/index.js";
// Keyword handlers: CyclingKeywordHandler, FlagKeywordHandler
import "../../src/keyword/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "standard",
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

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "13",
};

// Forgotten Cave: Land with Cycling {R}
// Keeping Oracle to a single line so the lexer doesn't choke on embedded newlines.
const forgottenCaveSrc = `${[
  "Name:Forgotten Cave",
  "Types:Land Mountain",
  "K:Cycling:R",
  "Oracle:Cycling {R} ({R}, Discard this card: Draw a card.)",
].join("\n")}\n`;

// Dummy card to seed in library (so drawCards has something to draw).
const dummyCardSrc = `${["Name:Plains", "Types:Land Plains", "Oracle:{T}: Add {W}."].join("\n")}\n`;

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(13n) });

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
}

function addCardToHand(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
}

function addCardToLibrary(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Library);
  game.cards.set(id, card);
  const library = game.getPlayer(seat).zones.get(ZoneType.Library);
  if (!library) throw new Error("test: missing library zone");
  library.add(id);
  return card;
}

// Drive a generator, automatically responding to decisions/replacements.
function driveGen(gen: Generator<unknown, unknown, unknown>): { events: string[] } {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Flagship: Cycling — Forgotten Cave end-to-end", () => {
  it("CyclingKeywordHandler synthesizes a Hand-zone activated ability", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);
    const cardId = mkEntityId(20000);

    const def = parseCard(forgottenCaveSrc, "forgotten-cave.txt");
    const paper: PaperCard = {
      name: "Forgotten Cave",
      edition: "ONS",
      collectorNumber: "310",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = addCardToHand(game, paper, seat, cardId);
    card.activateKeywordsFromDefinition(game);

    // Should have at least one synthesized cycling ability.
    const cyclingAbility = card.spellAbilities.find((sa) => sa.activeInZones.has(ZoneType.Hand));
    expect(cyclingAbility).toBeDefined();
    expect(cyclingAbility?.handlerKey).toBe("Draw");
    expect(cyclingAbility?.ast.cost.raw).toContain("Discard CARDNAME");
    expect(card.keywords?.has("cycling")).toBe(true);
  });

  it("cycle Forgotten Cave: {R}, Discard → draw a card (full end-to-end)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    // --- Forgotten Cave in hand ---
    const caveId = mkEntityId(21000);
    const caveDef = parseCard(forgottenCaveSrc, "forgotten-cave.txt");
    const cavePaper: PaperCard = {
      name: "Forgotten Cave",
      edition: "ONS",
      collectorNumber: "310",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: caveDef,
    };
    const caveCard = addCardToHand(game, cavePaper, seat, caveId);
    caveCard.activateKeywordsFromDefinition(game);

    // --- Dummy card in library (to draw) ---
    const dummyId = mkEntityId(21001);
    const dummyDef = parseCard(dummyCardSrc, "plains.txt");
    const dummyPaper: PaperCard = {
      name: "Plains",
      edition: "LEA",
      collectorNumber: "292",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: dummyDef,
    };
    addCardToLibrary(game, dummyPaper, seat, dummyId);

    // --- Verify initial state ---
    expect(caveCard.zone).toBe(ZoneType.Hand);
    const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    const library = game.getPlayer(seat).zones.get(ZoneType.Library);
    if (!library) throw new Error("test: missing library zone");
    const graveyard = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    if (!graveyard) throw new Error("test: missing graveyard zone");
    const handSizeBefore = hand.size;
    expect(library.size).toBe(1);

    // --- Seed 1 R mana ---
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat).manaPool = pool;
    expect(pool.size()).toBe(1);

    // --- Find cycling ability index ---
    const cyclingIndex = caveCard.spellAbilities.findIndex((sa) => sa.activeInZones.has(ZoneType.Hand));
    expect(cyclingIndex).toBeGreaterThanOrEqual(0);

    // --- Activate the cycling ability ---
    const { events: activateEvents } = driveGen(
      game.action.activateAbility(caveId, cyclingIndex, seat) as Generator<unknown, unknown, unknown>,
    );

    // Cost paid: mana drained, card discarded.
    expect(pool.size()).toBe(0); // R was spent
    expect(caveCard.zone).toBe(ZoneType.Graveyard); // card discarded
    expect(activateEvents).toContain("AbilityActivated");
    expect(activateEvents).toContain("CardChangedZone"); // discard event

    // Stack has the Draw-1 ability item.
    expect(game.sharedZones.stack.size).toBe(1);

    // --- Resolve the ability ---
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty after activateAbility");
    const { events: resolveEvents } = driveGen(
      resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>,
    );

    expect(resolveEvents).toContain("StackItemResolved");

    // Hand should have grown by 1 (dummy card drawn from library).
    expect(hand.size).toBe(handSizeBefore - 1 + 1); // cave left hand, dummy arrived
    // Specifically: cave is gone from hand, dummy is in hand.
    expect(hand.contains(caveId)).toBe(false);
    expect(hand.contains(dummyId)).toBe(true);

    // Graveyard contains the cave.
    expect(graveyard.contains(caveId)).toBe(true);

    // Library is now empty.
    expect(library.size).toBe(0);

    // Stack is empty.
    expect(game.sharedZones.stack.size).toBe(0);
  });
});

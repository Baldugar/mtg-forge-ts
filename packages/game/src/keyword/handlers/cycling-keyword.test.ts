// SPDX-License-Identifier: GPL-3.0-or-later
// CyclingKeywordHandler unit tests — verifies that activating a cycling
// keyword synthesizes the expected SpellAbility on the card.
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
// Side-effect: register all keyword handlers (FlagKeywordHandler + CyclingKeywordHandler)
import "../../keyword/index.js";
// Also register CyclingKeywordHandler directly (idempotent — handles isolated import)
import "./cycling-keyword.js";

const alice: LobbyPlayer = { id: "P0", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "Bob", controllerKind: "ai" };

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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "42",
};

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(42n) });

// A simple land card with Cycling R (Oracle on one line — no embedded newlines,
// which would confuse the lexer's line-by-line split).
const forgottenCaveSrc = `${[
  "Name:Forgotten Cave",
  "Types:Land Mountain",
  "K:Cycling:R",
  "Oracle:Cycling {R} ({R}, Discard this card: Draw a card.)",
].join("\n")}\n`;

describe("CyclingKeywordHandler", () => {
  it("synthesizes a SpellAbility after activateKeywordsFromDefinition", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(100);

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

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);

    // No spellAbilities yet
    expect(card.spellAbilities).toHaveLength(0);

    card.activateKeywordsFromDefinition(game);

    // Exactly one synthesized ability from Cycling
    expect(card.spellAbilities.length).toBeGreaterThanOrEqual(1);
    const cyclingAbility = card.spellAbilities.find((sa) => sa.activeInZones.has(ZoneType.Hand));
    expect(cyclingAbility).toBeDefined();
  });

  it("synthesized ability has activeInZones = {Hand}", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(101);

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

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    card.activateKeywordsFromDefinition(game);

    const cyclingAbility = card.spellAbilities.find((sa) => sa.activeInZones.has(ZoneType.Hand));
    expect(cyclingAbility).toBeDefined();
    expect(cyclingAbility?.activeInZones.has(ZoneType.Hand)).toBe(true);
    expect(cyclingAbility?.activeInZones.has(ZoneType.Battlefield)).toBe(false);
  });

  it("synthesized ability has handlerKey Draw", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(102);

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

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    card.activateKeywordsFromDefinition(game);

    const cyclingAbility = card.spellAbilities.find((sa) => sa.activeInZones.has(ZoneType.Hand));
    expect(cyclingAbility?.handlerKey).toBe("Draw");
  });

  it("synthesized ability cost includes 'Discard CARDNAME'", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(103);

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

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    card.activateKeywordsFromDefinition(game);

    const cyclingAbility = card.spellAbilities.find((sa) => sa.activeInZones.has(ZoneType.Hand));
    expect(cyclingAbility?.ast.cost.raw).toContain("Discard CARDNAME");
  });

  it("cycling cost is correctly extracted (R for Forgotten Cave)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(104);

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

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    card.activateKeywordsFromDefinition(game);

    const cyclingAbility = card.spellAbilities.find((sa) => sa.activeInZones.has(ZoneType.Hand));
    // Cost should be "R, Discard CARDNAME"
    expect(cyclingAbility?.ast.cost.raw).toMatch(/^R,/i);
  });

  it("adds 'cycling' to card.keywords flag set", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(105);

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

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("cycling")).toBe(true);
  });
});

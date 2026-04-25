// SPDX-License-Identifier: GPL-3.0-or-later
// Task 4 — bootstrap self-registration + integration with combat helpers.
//
// Part A: verify that importing keyword/index.js (which side-effect-imports
//   handlers/index.js → flag-keyword.js) registers FlagKeywordHandler as the
//   catchall fallback, making keywordHandlerRegistry.has("flying") return true.
//
// Part B: integration test — parse a card with K:Flying, call
//   activateKeywordsFromDefinition(), then verify that the combat helper
//   hasKeyword(game, cardId, "flying") returns true. This proves the full
//   pipeline from parser → Card.keywords → combat lookup is wired end-to-end.
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { hasKeyword } from "../../combat/damage-assignment-helpers.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
// Side-effect: registers FlagKeywordHandler (and all future handlers) with
// keywordHandlerRegistry. This is the canonical bootstrap import path.
import "../../keyword/index.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";

// ---------------------------------------------------------------------------
// Minimal game fixture
// ---------------------------------------------------------------------------

const alice: LobbyPlayer = { id: "P0", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "Bob", controllerKind: "human" };

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
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadcafe",
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadcafen),
  });

// ---------------------------------------------------------------------------
// Bootstrap tests (Part A)
// ---------------------------------------------------------------------------

describe("keyword bootstrap registration", () => {
  it("keywordHandlerRegistry.has('flying') returns true after bootstrap import", () => {
    // FlagKeywordHandler registers as fallback ("*"), so has() returns true
    // for any keyword including "flying".
    expect(keywordHandlerRegistry.has("flying")).toBe(true);
  });

  it("keywordHandlerRegistry.has('trample') returns true after bootstrap import", () => {
    expect(keywordHandlerRegistry.has("trample")).toBe(true);
  });

  it("keywordHandlerRegistry.has('warp') returns true (caught by fallback)", () => {
    expect(keywordHandlerRegistry.has("warp")).toBe(true);
  });

  it("lookup('flying') returns the FlagKeywordHandler (via fallback)", () => {
    const Cls = keywordHandlerRegistry.lookup("flying");
    expect(Cls).toBeDefined();
    // Instantiate and verify it has activate/deactivate
    if (!Cls) return;
    const handler = new Cls();
    expect(typeof handler.activate).toBe("function");
    expect(typeof handler.deactivate).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Combat integration test (Part B)
// ---------------------------------------------------------------------------

const flyingCreatureSrc = `${[
  "Name:Snowy Eagle",
  "ManaCost:1 W",
  "Types:Creature - Bird",
  "PT:2/1",
  "K:Flying",
  "Oracle:Flying.",
].join("\n")}\n`;

describe("keyword → combat integration: hasKeyword after activateKeywordsFromDefinition", () => {
  it("hasKeyword(game, cardId, 'flying') returns true after keyword activation", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(100);

    const def = parseCard(flyingCreatureSrc, "snowy-eagle.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    // Before activation: hasKeyword should return false
    expect(hasKeyword(game, id, "flying")).toBe(false);

    // After activation: hasKeyword should return true
    card.activateKeywordsFromDefinition(game);
    expect(hasKeyword(game, id, "flying")).toBe(true);
  });

  it("hasKeyword returns false for a keyword not on the card", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(101);

    const def = parseCard(flyingCreatureSrc, "snowy-eagle.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    card.activateKeywordsFromDefinition(game);

    expect(hasKeyword(game, id, "trample")).toBe(false);
    expect(hasKeyword(game, id, "deathtouch")).toBe(false);
  });

  it("multiple keywords all accessible via hasKeyword", () => {
    const trampleDeathtouchSrc = `${[
      "Name:Gnarlid Colony",
      "ManaCost:2 G",
      "Types:Creature - Beast",
      "PT:3/3",
      "K:Trample",
      "K:Deathtouch",
      "Oracle:Trample, deathtouch.",
    ].join("\n")}\n`;

    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(102);

    const def = parseCard(trampleDeathtouchSrc, "gnarlid-colony.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "002",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    card.activateKeywordsFromDefinition(game);

    expect(hasKeyword(game, id, "trample")).toBe(true);
    expect(hasKeyword(game, id, "deathtouch")).toBe(true);
    expect(hasKeyword(game, id, "flying")).toBe(false);
  });
});

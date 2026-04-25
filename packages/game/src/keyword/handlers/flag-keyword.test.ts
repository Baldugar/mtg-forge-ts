// SPDX-License-Identifier: GPL-3.0-or-later
// Task 2 — FlagKeywordHandler unit tests.
// Verifies that activate adds the keyword to Card.keywords and deactivate
// removes it, using a minimal in-memory Game + Card fixture.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { FlagKeywordHandler } from "./flag-keyword.js";

// ---------------------------------------------------------------------------
// Minimal game fixture
// ---------------------------------------------------------------------------

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  seed: "cafebabe",
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xcafebaben),
  });

const tokenPaper: PaperCard = {
  name: "Test Creature",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

// Restore registry between tests to avoid fallback-leakage across suites that
// might clear the registry.
afterEach(() => {
  // Re-register the fallback in case another suite cleared the registry.
  // (The module-level register call only runs once at import time.)
  if (!keywordHandlerRegistry.has("flying")) {
    keywordHandlerRegistry.register(FlagKeywordHandler);
  }
});

describe("FlagKeywordHandler", () => {
  it("activate adds the keyword to card.keywords Set", () => {
    const game = mkGame();
    const id = mkEntityId(10);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    const handler = new FlagKeywordHandler();
    handler.activate({ keyword: "flying" }, { game, sourceCardId: id, controllerSeat: seat });

    expect(card.keywords).toBeDefined();
    expect(card.keywords?.has("flying")).toBe(true);
  });

  it("activate creates the keywords Set when undefined", () => {
    const game = mkGame();
    const id = mkEntityId(11);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    expect(card.keywords).toBeUndefined();

    const handler = new FlagKeywordHandler();
    handler.activate({ keyword: "trample" }, { game, sourceCardId: id, controllerSeat: seat });

    expect(card.keywords).toBeDefined();
    expect(card.keywords?.has("trample")).toBe(true);
  });

  it("activate accumulates multiple keywords on the same card", () => {
    const game = mkGame();
    const id = mkEntityId(12);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    const handler = new FlagKeywordHandler();
    handler.activate({ keyword: "flying" }, { game, sourceCardId: id, controllerSeat: seat });
    handler.activate({ keyword: "trample" }, { game, sourceCardId: id, controllerSeat: seat });

    expect(card.keywords?.has("flying")).toBe(true);
    expect(card.keywords?.has("trample")).toBe(true);
    expect(card.keywords?.size).toBe(2);
  });

  it("deactivate removes only the targeted keyword, leaving others intact", () => {
    const game = mkGame();
    const id = mkEntityId(13);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    const handler = new FlagKeywordHandler();
    handler.activate({ keyword: "flying" }, { game, sourceCardId: id, controllerSeat: seat });
    handler.activate({ keyword: "trample" }, { game, sourceCardId: id, controllerSeat: seat });

    handler.deactivate?.({ keyword: "flying" }, { game, sourceCardId: id, controllerSeat: seat });

    expect(card.keywords?.has("flying")).toBe(false);
    expect(card.keywords?.has("trample")).toBe(true);
  });

  it("deactivate is a no-op when card is not in game.cards", () => {
    const game = mkGame();
    const id = mkEntityId(14);
    const seat = mkPlayerSeat(0);
    // Intentionally NOT adding card to game.cards
    const handler = new FlagKeywordHandler();
    // Should not throw
    expect(() =>
      handler.deactivate?.({ keyword: "flying" }, { game, sourceCardId: id, controllerSeat: seat }),
    ).not.toThrow();
  });

  it("deactivate is a no-op when keywords Set is undefined", () => {
    const game = mkGame();
    const id = mkEntityId(15);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.keywords).toBeUndefined();

    const handler = new FlagKeywordHandler();
    // Should not throw
    expect(() =>
      handler.deactivate?.({ keyword: "flying" }, { game, sourceCardId: id, controllerSeat: seat }),
    ).not.toThrow();
  });

  it("is registered as the catchall fallback in keywordHandlerRegistry", () => {
    // FlagKeywordHandler self-registers with keyword="*"
    // has() returns true even for an unknown keyword id because of the fallback
    expect(keywordHandlerRegistry.has("flying")).toBe(true);
    expect(keywordHandlerRegistry.has("warp")).toBe(true);
    expect(keywordHandlerRegistry.lookup("warp")).toBe(FlagKeywordHandler);
  });
});

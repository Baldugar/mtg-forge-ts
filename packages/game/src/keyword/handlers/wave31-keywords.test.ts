// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 31 — smoke tests for Persist + Undying death-trigger handlers.
//
// Each test exercises only the durable contract of its mechanic — handler
// registration, keyword stamping, and the data-layer side effect (triggered
// ability registered on Battlefield → Graveyard).
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { PersistKeywordHandler } from "./persist-keyword.js";
import { UndyingKeywordHandler } from "./undying-keyword.js";

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const paper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const ALICE = mkPlayerSeat(0);

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

describe("Wave 31 keyword handlers — registration", () => {
  it("PersistKeywordHandler is registered under 'persist'", () => {
    expect(keywordHandlerRegistry.has("persist")).toBe(true);
  });
  it("UndyingKeywordHandler is registered under 'undying'", () => {
    expect(keywordHandlerRegistry.has("undying")).toBe(true);
  });
});

describe("Wave 31 — Persist activate stamps keyword + LTB trigger", () => {
  it("stamps `persist` keyword and registers a death-triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(311);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new PersistKeywordHandler().activate(
      { keyword: "persist" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("persist")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 31 — Undying activate stamps keyword + LTB trigger", () => {
  it("stamps `undying` keyword and registers a death-triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(312);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new UndyingKeywordHandler().activate(
      { keyword: "undying" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("undying")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

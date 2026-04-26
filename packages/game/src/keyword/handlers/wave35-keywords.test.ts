// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 35 — smoke tests for Vanishing + Fading. Phasing already works via
// FlagKeywordHandler + processPhasingOnUntap (separate test file in
// packages/game/src/phasing/).
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
import { FadingKeywordHandler } from "./fading-keyword.js";
import { VanishingKeywordHandler } from "./vanishing-keyword.js";

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

describe("Wave 35 keyword handlers — registration", () => {
  it("VanishingKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("vanishing")).toBe(true);
  });
  it("FadingKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("fading")).toBe(true);
  });
});

describe("Wave 35 — Vanishing activate stamps keyword + ETB + Upkeep triggers", () => {
  it("stamps `vanishing` keyword and registers ETB + upkeep triggers", () => {
    const game = mkGame();
    const id = mkEntityId(351);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new VanishingKeywordHandler().activate(
      { keyword: "vanishing", params: { amount: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("vanishing")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(2);
  });
});

describe("Wave 35 — Fading activate stamps keyword + ETB + Upkeep triggers", () => {
  it("stamps `fading` keyword and registers ETB + upkeep triggers", () => {
    const game = mkGame();
    const id = mkEntityId(352);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new FadingKeywordHandler().activate(
      { keyword: "fading", params: { amount: { kind: "literal", raw: "5" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("fading")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(2);
  });
});

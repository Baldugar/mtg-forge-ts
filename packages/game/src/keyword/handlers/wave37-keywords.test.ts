// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 37 — smoke tests for Devour, Soulshift, Soulbond, Splice,
// Hideaway, Sunburst keyword handlers.
//
// Each test exercises only the durable contract of its mechanic —
// handler registration, keyword stamping, and either the data-layer
// side effect (triggered ability registered) or the AltCost
// availability gate (Splice).
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
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { DevourKeywordHandler } from "./devour-keyword.js";
import { HideawayKeywordHandler } from "./hideaway-keyword.js";
import { SoulbondKeywordHandler } from "./soulbond-keyword.js";
import { SoulshiftKeywordHandler } from "./soulshift-keyword.js";
import { SpliceKeywordHandler } from "./splice-keyword.js";
import { SunburstKeywordHandler } from "./sunburst-keyword.js";

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

describe("Wave 37 keyword handlers — registration", () => {
  it("DevourKeywordHandler is registered under 'devour'", () => {
    expect(keywordHandlerRegistry.has("devour")).toBe(true);
  });
  it("SoulshiftKeywordHandler is registered under 'soulshift'", () => {
    expect(keywordHandlerRegistry.has("soulshift")).toBe(true);
  });
  it("SoulbondKeywordHandler is registered under 'soulbond'", () => {
    expect(keywordHandlerRegistry.has("soulbond")).toBe(true);
  });
  it("SpliceKeywordHandler is registered under 'splice'", () => {
    expect(keywordHandlerRegistry.has("splice")).toBe(true);
  });
  it("HideawayKeywordHandler is registered under 'hideaway'", () => {
    expect(keywordHandlerRegistry.has("hideaway")).toBe(true);
  });
  it("SunburstKeywordHandler is registered under 'sunburst'", () => {
    expect(keywordHandlerRegistry.has("sunburst")).toBe(true);
  });
  it("Splice AltCost is registered under 'Splice'", () => {
    expect(altCostRegistry.has("Splice")).toBe(true);
  });
});

describe("Wave 37 — Devour activate stamps keyword + ETB trigger", () => {
  it("stamps `devour` keyword and registers an ETB-triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(370);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new DevourKeywordHandler().activate(
      { keyword: "devour", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("devour")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 37 — Soulshift activate stamps keyword + LTB trigger", () => {
  it("stamps `soulshift` keyword and registers a death-triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(371);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SoulshiftKeywordHandler().activate(
      { keyword: "soulshift", params: { amount: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("soulshift")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 37 — Soulbond activate stamps keyword + ETB & LTB triggers", () => {
  it("stamps `soulbond` keyword and registers both pair-up + cleanup triggers", () => {
    const game = mkGame();
    const id = mkEntityId(372);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SoulbondKeywordHandler().activate(
      { keyword: "soulbond" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("soulbond")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(2);
    // pairedWith starts undefined.
    expect(card.pairedWith).toBeUndefined();
  });
});

describe("Wave 37 — Splice activate stamps keyword (AltCost handles cost path)", () => {
  it("stamps `splice` keyword on the card without registering a trigger", () => {
    const game = mkGame();
    const id = mkEntityId(373);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SpliceKeywordHandler().activate(
      { keyword: "splice", params: { detail: { kind: "literal", raw: "Arcane:G" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("splice")).toBe(true);
    // Splice doesn't synthesize a trigger — its work lives in the
    // AltCost handler invoked by the cast pipeline.
    expect(card.triggeredAbilities?.length ?? 0).toBe(0);
  });
});

describe("Wave 37 — Hideaway activate stamps keyword + ETB trigger", () => {
  it("stamps `hideaway` keyword and registers an ETB-triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(374);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new HideawayKeywordHandler().activate(
      { keyword: "hideaway" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("hideaway")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    expect(card.hideawayCard).toBeUndefined();
  });
});

describe("Wave 37 — Sunburst activate stamps keyword + ETB trigger", () => {
  it("stamps `sunburst` keyword and registers an ETB-triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(375);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SunburstKeywordHandler().activate(
      { keyword: "sunburst" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("sunburst")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    expect(card.manaSpentColors).toBeUndefined();
  });
});

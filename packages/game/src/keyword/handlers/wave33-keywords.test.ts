// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 33 — smoke tests for Embalm + Eternalize keyword handlers and the
// Aftermath alt-cost.
//
// Each test exercises only the durable contract of its mechanic — handler
// registration, keyword stamping, and the data-layer side effect (a
// synthesized SpellAbility on the Graveyard-zone).
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard, TypeLine } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { EmbalmKeywordHandler } from "./embalm-keyword.js";
import { EternalizeKeywordHandler } from "./eternalize-keyword.js";

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
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
  }
  return game;
};

describe("Wave 33 keyword handlers — registration", () => {
  it("EmbalmKeywordHandler is registered under 'embalm'", () => {
    expect(keywordHandlerRegistry.has("embalm")).toBe(true);
  });
  it("EternalizeKeywordHandler is registered under 'eternalize'", () => {
    expect(keywordHandlerRegistry.has("eternalize")).toBe(true);
  });
  it("Aftermath AltCost is registered", () => {
    expect(altCostRegistry.has("Aftermath")).toBe(true);
  });
});

describe("Wave 33 — Embalm activate stamps keyword + synthesizes Graveyard SA", () => {
  it("stamps `embalm` keyword and pushes a Graveyard-zone activated SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(331);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    new EmbalmKeywordHandler().activate(
      { keyword: "embalm", params: { cost: { kind: "literal", raw: "3 W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("embalm")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa).toBeDefined();
    if (!sa) return;
    expect(sa.handlerKey).toBe("Embalm");
    expect(sa.activeInZones.has(ZoneType.Graveyard)).toBe(true);
    expect(sa.tags.has("embalm")).toBe(true);
    expect(sa.tags.has("sorcery_speed")).toBe(true);
  });
});

describe("Wave 33 — Eternalize activate stamps keyword + synthesizes Graveyard SA", () => {
  it("stamps `eternalize` keyword and pushes a Graveyard-zone activated SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(332);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    new EternalizeKeywordHandler().activate(
      { keyword: "eternalize", params: { cost: { kind: "literal", raw: "3 W W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("eternalize")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa).toBeDefined();
    if (!sa) return;
    expect(sa.handlerKey).toBe("Eternalize");
    expect(sa.activeInZones.has(ZoneType.Graveyard)).toBe(true);
    expect(sa.tags.has("eternalize")).toBe(true);
    expect(sa.tags.has("sorcery_speed")).toBe(true);
  });
});

describe("Wave 33 — Aftermath AltCost availability", () => {
  it("is available when the card sits in the graveyard with K:Aftermath", () => {
    const game = mkGame();
    const id = mkEntityId(333);
    const aftermathPaper: PaperCard = {
      ...paper,
      definition: {
        name: "Test",
        oracle: "",
        types: { supertypes: new Set(), types: new Set(), subtypes: new Set() } as unknown as TypeLine,
        manaCost: null,
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [{ keyword: "aftermath" }],
        svars: new Map(),
      },
    };
    const card = new Card(id, aftermathPaper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    const aftermath = altCostRegistry.lookup("Aftermath");
    expect(aftermath).toBeDefined();
    if (!aftermath) return;
    expect(aftermath.isAvailable(card, game)).toBe(true);
  });

  it("is NOT available when the card is in hand instead of graveyard", () => {
    const game = mkGame();
    const id = mkEntityId(334);
    const aftermathPaper: PaperCard = {
      ...paper,
      definition: {
        name: "Test",
        oracle: "",
        types: { supertypes: new Set(), types: new Set(), subtypes: new Set() } as unknown as TypeLine,
        manaCost: null,
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [{ keyword: "aftermath" }],
        svars: new Map(),
      },
    };
    const card = new Card(id, aftermathPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    const aftermath = altCostRegistry.lookup("Aftermath");
    expect(aftermath).toBeDefined();
    if (!aftermath) return;
    expect(aftermath.isAvailable(card, game)).toBe(false);
  });

  it("is NOT available when the card has no aftermath keyword", () => {
    const game = mkGame();
    const id = mkEntityId(335);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    const aftermath = altCostRegistry.lookup("Aftermath");
    expect(aftermath).toBeDefined();
    if (!aftermath) return;
    expect(aftermath.isAvailable(card, game)).toBe(false);
  });
});

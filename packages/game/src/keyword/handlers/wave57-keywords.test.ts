// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 57 — smoke tests for the niche-keyword cleanup batch:
// Annihilator, Battle cry, Exalted, Prowess, Extort, Melee, Bloodthirst,
// Fabricate, Cipher, Awaken, Buyback. Each test exercises only the
// durable contract of its mechanic — handler / AltCost registration,
// keyword stamping, slot population, and the per-keyword side effects
// (triggered abilities count / altcost lookup).
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
import { Hand } from "../../zone/zones/hand.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { AnnihilatorKeywordHandler } from "./annihilator-keyword.js";
import { AwakenKeywordHandler } from "./awaken-keyword.js";
import { BattleCryKeywordHandler } from "./battle-cry-keyword.js";
import { BloodthirstKeywordHandler } from "./bloodthirst-keyword.js";
import { CipherKeywordHandler } from "./cipher-keyword.js";
import { ExaltedKeywordHandler } from "./exalted-keyword.js";
import { ExtortKeywordHandler } from "./extort-keyword.js";
import { FabricateKeywordHandler } from "./fabricate-keyword.js";
import { MeleeKeywordHandler } from "./melee-keyword.js";
import { ProwessKeywordHandler } from "./prowess-keyword.js";

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

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
  }
  return game;
};

describe("Wave 57 keyword handlers — registration", () => {
  it("AnnihilatorKeywordHandler is registered under 'annihilator'", () => {
    expect(keywordHandlerRegistry.lookup("annihilator")).toBe(AnnihilatorKeywordHandler);
  });
  it("BattleCryKeywordHandler is registered under 'battle_cry'", () => {
    expect(keywordHandlerRegistry.lookup("battle_cry")).toBe(BattleCryKeywordHandler);
  });
  it("ExaltedKeywordHandler is registered under 'exalted'", () => {
    expect(keywordHandlerRegistry.lookup("exalted")).toBe(ExaltedKeywordHandler);
  });
  it("ProwessKeywordHandler is registered under 'prowess'", () => {
    expect(keywordHandlerRegistry.lookup("prowess")).toBe(ProwessKeywordHandler);
  });
  it("ExtortKeywordHandler is registered under 'extort'", () => {
    expect(keywordHandlerRegistry.lookup("extort")).toBe(ExtortKeywordHandler);
  });
  it("MeleeKeywordHandler is registered under 'melee'", () => {
    expect(keywordHandlerRegistry.lookup("melee")).toBe(MeleeKeywordHandler);
  });
  it("BloodthirstKeywordHandler is registered under 'bloodthirst'", () => {
    expect(keywordHandlerRegistry.lookup("bloodthirst")).toBe(BloodthirstKeywordHandler);
  });
  it("FabricateKeywordHandler is registered under 'fabricate'", () => {
    expect(keywordHandlerRegistry.lookup("fabricate")).toBe(FabricateKeywordHandler);
  });
  it("CipherKeywordHandler is registered under 'cipher'", () => {
    expect(keywordHandlerRegistry.lookup("cipher")).toBe(CipherKeywordHandler);
  });
  it("AwakenKeywordHandler is registered under 'awaken'", () => {
    expect(keywordHandlerRegistry.lookup("awaken")).toBe(AwakenKeywordHandler);
  });
  it("Buyback AltCost is registered", () => {
    expect(altCostRegistry.has("Buyback")).toBe(true);
  });
});

describe("Wave 57 — Annihilator", () => {
  it("activate stamps keyword + 1 attacks-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5701);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new AnnihilatorKeywordHandler().activate(
      { keyword: "annihilator", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("annihilator")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Battle cry", () => {
  it("activate stamps keyword + 1 attacks-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5702);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new BattleCryKeywordHandler().activate(
      { keyword: "battle_cry" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("battle_cry")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Exalted", () => {
  it("activate stamps keyword + 1 attacks-alone-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5703);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ExaltedKeywordHandler().activate(
      { keyword: "exalted" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("exalted")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Prowess", () => {
  it("activate stamps keyword + 1 spellcast-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5704);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ProwessKeywordHandler().activate(
      { keyword: "prowess" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("prowess")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Extort", () => {
  it("activate stamps keyword + 1 spellcast-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5705);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ExtortKeywordHandler().activate(
      { keyword: "extort" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("extort")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Melee", () => {
  it("activate stamps keyword + 1 attacks-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5706);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new MeleeKeywordHandler().activate(
      { keyword: "melee" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("melee")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Bloodthirst", () => {
  it("activate stamps keyword + an etbCounterSpec (M6.26 — static replacement)", () => {
    const game = mkGame();
    const id = mkEntityId(5707);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new BloodthirstKeywordHandler().activate(
      { keyword: "bloodthirst", params: { amount: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("bloodthirst")).toBe(true);
    // M6.26: Bloodthirst no longer registers a triggered ability. The
    // counter-place runs through `applyEtbStamping` (CR 614 replacement).
    const specs = (
      card as unknown as {
        etbCounterSpecs?: ReadonlyArray<{ readonly condition?: string; readonly amount: number }>;
      }
    ).etbCounterSpecs;
    expect(specs).toBeDefined();
    expect(specs?.length).toBe(1);
    const first = specs?.[0];
    expect(first?.condition).toBe("bloodthirst");
    expect(first?.amount).toBe(3);
  });
});

describe("Wave 57 — Fabricate", () => {
  it("activate stamps keyword + 1 ETB trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5708);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new FabricateKeywordHandler().activate(
      { keyword: "fabricate", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("fabricate")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Cipher", () => {
  it("activate stamps keyword + 2 triggers (cast + damage) + slot defaults", () => {
    const game = mkGame();
    const id = mkEntityId(5709);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new CipherKeywordHandler().activate(
      { keyword: "cipher" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("cipher")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(2);
    expect(card.cipherEncodedOnId).toBeUndefined();
    expect(card.cipherEncodedHere).toBeUndefined();
  });
});

describe("Wave 57 — Awaken", () => {
  it("activate stamps keyword + awakenAmount slot + 1 spellcast-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5710);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new AwakenKeywordHandler().activate(
      {
        keyword: "awaken",
        params: {
          amount: { kind: "literal", raw: "3" },
          cost: { kind: "literal", raw: "4 U" },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("awaken")).toBe(true);
    expect(card.awakenAmount).toBe(3);
    expect(card.kickerCost).toBe("4 U");
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 57 — Buyback (AltCost)", () => {
  it("Buyback is available for a hand card with K:Buyback", () => {
    const game = mkGame();
    const id = mkEntityId(5711);
    const buybackPaper: PaperCard = {
      ...paper,
      definition: {
        name: "BB Test",
        oracle: "",
        types: paper.definition?.types ?? (undefined as never),
        manaCost: { raw: "2 U" } as never,
        pt: null,
        colors: undefined as never,
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [{ keyword: "buyback", params: { cost: { kind: "literal", raw: "3" } } }],
        svars: new Map(),
      } as never,
    };
    const card = new Card(id, buybackPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    const buyback = altCostRegistry.lookup("Buyback");
    expect(buyback).toBeDefined();
    expect(buyback?.isAvailable(card, game)).toBe(true);
  });

  it("Buyback NOT available for a battlefield card", () => {
    const game = mkGame();
    const id = mkEntityId(5712);
    const buybackPaper: PaperCard = {
      ...paper,
      definition: {
        name: "BB BF",
        oracle: "",
        types: undefined as never,
        manaCost: { raw: "2 U" } as never,
        pt: null,
        colors: undefined as never,
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [{ keyword: "buyback", params: { cost: { kind: "literal", raw: "3" } } }],
        svars: new Map(),
      } as never,
    };
    const card = new Card(id, buybackPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(altCostRegistry.lookup("Buyback")?.isAvailable(card, game)).toBe(false);
  });
});

describe("Wave 57 — slot defaults", () => {
  it("Card defaults cipher / buyback / awaken slots to undefined", () => {
    const game = mkGame();
    const id = mkEntityId(5713);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.cipherEncodedOnId).toBeUndefined();
    expect(card.cipherEncodedHere).toBeUndefined();
    expect(card.buybackPaid).toBeUndefined();
    expect(card.awakenAmount).toBeUndefined();
  });
});

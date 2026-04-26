// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 39 — smoke tests for Bushido / Outlast / Provoke / Skulk /
// Friends Forever / Tempting Offer / Ripple / Sweep / Companion. Each
// test exercises only the durable contract of its mechanic — handler
// registration, keyword stamping, and the data-layer side effect
// (synthesized SpellAbility, registered TriggeredAbility, or runtime
// flag slot).
import "../../ability/effects/index.js";
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
import { BushidoKeywordHandler } from "./bushido-keyword.js";
import { CompanionKeywordHandler } from "./companion-keyword.js";
import { FriendsForeverKeywordHandler } from "./friends-forever-keyword.js";
import { OutlastKeywordHandler } from "./outlast-keyword.js";
import { ProvokeKeywordHandler } from "./provoke-keyword.js";
import { RippleKeywordHandler } from "./ripple-keyword.js";
import { SkulkKeywordHandler } from "./skulk-keyword.js";
import { SweepKeywordHandler } from "./sweep-keyword.js";
import { TemptingOfferKeywordHandler } from "./tempting-offer-keyword.js";

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

describe("Wave 39 keyword handlers — registration", () => {
  it("BushidoKeywordHandler is registered under 'bushido'", () => {
    expect(keywordHandlerRegistry.has("bushido")).toBe(true);
  });
  it("OutlastKeywordHandler is registered under 'outlast'", () => {
    expect(keywordHandlerRegistry.has("outlast")).toBe(true);
  });
  it("ProvokeKeywordHandler is registered under 'provoke'", () => {
    expect(keywordHandlerRegistry.has("provoke")).toBe(true);
  });
  it("SkulkKeywordHandler is registered under 'skulk'", () => {
    expect(keywordHandlerRegistry.has("skulk")).toBe(true);
  });
  it("FriendsForeverKeywordHandler is registered under 'friends_forever'", () => {
    expect(keywordHandlerRegistry.has("friends_forever")).toBe(true);
  });
  it("TemptingOfferKeywordHandler is registered under 'tempting_offer'", () => {
    expect(keywordHandlerRegistry.has("tempting_offer")).toBe(true);
  });
  it("RippleKeywordHandler is registered under 'ripple'", () => {
    expect(keywordHandlerRegistry.has("ripple")).toBe(true);
  });
  it("SweepKeywordHandler is registered under 'sweep'", () => {
    expect(keywordHandlerRegistry.has("sweep")).toBe(true);
  });
  it("CompanionKeywordHandler is registered under 'companion'", () => {
    expect(keywordHandlerRegistry.has("companion")).toBe(true);
  });
});

describe("Wave 39 — Bushido registers a BlockersDeclared trigger", () => {
  it("stamps `bushido` keyword and registers a battlefield trigger", () => {
    const game = mkGame();
    const id = mkEntityId(390);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new BushidoKeywordHandler().activate(
      { keyword: "bushido", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("bushido")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
  });
});

describe("Wave 39 — Outlast synthesizes a Battlefield-zone activated SpellAbility", () => {
  it("stamps `outlast` keyword and pushes a sorcery-speed Battlefield SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(391);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new OutlastKeywordHandler().activate(
      { keyword: "outlast", params: { cost: { kind: "literal", raw: "W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("outlast")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(sa?.handlerKey).toBe("PutCounter");
    expect(sa?.tags.has("outlast")).toBe(true);
    expect(sa?.tags.has("sorcery_speed")).toBe(true);
  });
});

describe("Wave 39 — Provoke registers an AttackersDeclared trigger", () => {
  it("stamps `provoke` keyword and registers a battlefield trigger", () => {
    const game = mkGame();
    const id = mkEntityId(392);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ProvokeKeywordHandler().activate(
      { keyword: "provoke" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("provoke")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
  });
});

describe("Wave 39 — Skulk stamps the keyword", () => {
  it("stamps `skulk` keyword without a trigger or SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(393);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SkulkKeywordHandler().activate(
      { keyword: "skulk" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("skulk")).toBe(true);
    expect(card.spellAbilities.length).toBe(0);
    expect(card.triggeredAbilities?.length ?? 0).toBe(0);
  });
});

describe("Wave 39 — Friends Forever stamps the keyword", () => {
  it("stamps `friends_forever` keyword as a deck-validation flag", () => {
    const game = mkGame();
    const id = mkEntityId(394);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new FriendsForeverKeywordHandler().activate(
      { keyword: "friends_forever" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("friends_forever")).toBe(true);
  });
});

describe("Wave 39 — Tempting Offer stamps the keyword", () => {
  it("stamps `tempting_offer` keyword as a trigger-mode flag", () => {
    const game = mkGame();
    const id = mkEntityId(395);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new TemptingOfferKeywordHandler().activate(
      { keyword: "tempting_offer" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("tempting_offer")).toBe(true);
  });
});

describe("Wave 39 — Ripple registers a SpellCast self-trigger", () => {
  it("stamps `ripple` keyword and registers a triggered ability on Stack", () => {
    const game = mkGame();
    const id = mkEntityId(396);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new RippleKeywordHandler().activate(
      { keyword: "ripple", params: { amount: { kind: "literal", raw: "4" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("ripple")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Stack)).toBe(true);
  });
});

describe("Wave 39 — Sweep registers a SpellCast self-trigger and the type slot", () => {
  it("stamps `sweep` keyword + `sweepReturnedType` slot and registers a triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(397);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SweepKeywordHandler().activate(
      { keyword: "sweep", params: { type: { kind: "literal", raw: "Plains" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("sweep")).toBe(true);
    const slot = (card as unknown as { sweepReturnedType?: string }).sweepReturnedType;
    expect(slot).toBe("Plains");
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Stack)).toBe(true);
  });
});

describe("Wave 39 — Companion stamps the keyword + condition slot", () => {
  it("stamps `companion` keyword and the condition slot extracted from detail", () => {
    const game = mkGame();
    const id = mkEntityId(398);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new CompanionKeywordHandler().activate(
      {
        keyword: "companion",
        params: {
          detail: {
            kind: "literal",
            raw: "Card.cmcM20:Your starting deck contains only cards with even mana value.",
          },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("companion")).toBe(true);
    const cond = (card as unknown as { companionCondition?: string }).companionCondition;
    expect(cond).toBe("Card.cmcM20");
  });
});

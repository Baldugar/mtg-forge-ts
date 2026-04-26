// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 29 — smoke tests for the five new keyword mechanics:
// Adapt / Renown / Mentor / Disturb (altcost) / Daybound+Nightbound auto-flip.
//
// Each test exercises only the durable contract of its mechanic — handler
// registration, keyword stamping, and the data-layer side effect that the
// engine layer downstream consumes.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { AdaptKeywordHandler } from "./adapt-keyword.js";
import { MentorKeywordHandler } from "./mentor-keyword.js";
import { RenownKeywordHandler } from "./renown-keyword.js";

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

describe("Wave 29 keyword handlers — registration", () => {
  it("AdaptKeywordHandler is registered under 'adapt'", () => {
    expect(keywordHandlerRegistry.has("adapt")).toBe(true);
  });
  it("RenownKeywordHandler is registered under 'renown'", () => {
    expect(keywordHandlerRegistry.has("renown")).toBe(true);
  });
  it("MentorKeywordHandler is registered under 'mentor'", () => {
    expect(keywordHandlerRegistry.has("mentor")).toBe(true);
  });
});

describe("Wave 29 — Adapt activate stamps keyword + spell ability", () => {
  it("stamps `adapt` keyword and synthesizes an activated SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(11);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new AdaptKeywordHandler();
    handler.activate(
      {
        keyword: "adapt",
        params: {
          amount: { kind: "literal", raw: "2" },
          cost: { kind: "literal", raw: "2 G" },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("adapt")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa).toBeDefined();
    expect(sa?.handlerKey).toBe("Adapt");
  });
});

describe("Wave 29 — Renown activate stamps keyword + initial flag", () => {
  it("stamps `renown` keyword and sets renowned=false", () => {
    const game = mkGame();
    const id = mkEntityId(12);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new RenownKeywordHandler();
    handler.activate(
      { keyword: "renown", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("renown")).toBe(true);
    expect(card.renowned).toBe(false);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 29 — Mentor activate stamps keyword + trigger", () => {
  it("stamps `mentor` keyword and registers an attack-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(13);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new MentorKeywordHandler();
    handler.activate({ keyword: "mentor" }, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.keywords?.has("mentor")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 29 — Disturb altcost is registered", () => {
  it("Disturb altcost is registered with the altcost registry", async () => {
    const { altCostRegistry } = await import("../../registries/alt-cost-registry.js");
    expect(altCostRegistry.lookup("Disturb")).not.toBeUndefined();
  });
});

describe("Wave 29 — Daybound auto-flip on Day→Night", () => {
  it("flips card.face from default to back when day transitions to night", async () => {
    const game = mkGame();
    const id = mkEntityId(14);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("daybound");
    game.cards.set(id, card);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(id);
    // Seed Day/Night state to "day", and arrange for the previous turn's
    // controller to have cast 0 non-land spells so the upkeep transition
    // flips day → night.
    game.flags.dayNight = "day";
    game.flags.lastTurnActiveSeat = ALICE;
    game.flags.lastTurnSpellsCast.clear();
    game.flags.lastTurnSpellsCast.set(ALICE, 0);

    const { tryUpkeepTransition } = await import("../../phase/day-night-tracker.js");
    const t = tryUpkeepTransition(game);
    expect(t).not.toBeNull();
    expect(t?.newValue).toBe("night");
    expect(card.face).toBe("back");
  });
});

void CounterType;
void CardType;

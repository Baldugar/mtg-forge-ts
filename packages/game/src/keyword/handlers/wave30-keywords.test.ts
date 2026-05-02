// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 30 — smoke tests for the seven new keyword mechanics:
// Storm / Ninjutsu / Graft / Modular / Living Weapon / Riot / Rebound.
//
// Each test exercises only the durable contract of its mechanic — handler
// registration, keyword stamping, and the data-layer side effect that the
// engine layer downstream consumes.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
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
import { GraftKeywordHandler } from "./graft-keyword.js";
import { LivingWeaponKeywordHandler } from "./living-weapon-keyword.js";
import { ModularKeywordHandler } from "./modular-keyword.js";
import { NinjutsuKeywordHandler } from "./ninjutsu-keyword.js";
import { ReboundKeywordHandler } from "./rebound-keyword.js";
import { RiotKeywordHandler } from "./riot-keyword.js";
import { StormKeywordHandler } from "./storm-keyword.js";

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

describe("Wave 30 keyword handlers — registration", () => {
  it("StormKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("storm")).toBe(true);
  });
  it("NinjutsuKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("ninjutsu")).toBe(true);
  });
  it("GraftKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("graft")).toBe(true);
  });
  it("ModularKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("modular")).toBe(true);
  });
  it("LivingWeaponKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("living_weapon")).toBe(true);
  });
  it("RiotKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("riot")).toBe(true);
  });
  it("ReboundKeywordHandler registered", () => {
    expect(keywordHandlerRegistry.has("rebound")).toBe(true);
  });
});

describe("Wave 30 — Storm activate stamps keyword + registers SpellCast trigger", () => {
  it("stamps `storm` keyword and registers a triggered ability", () => {
    const game = mkGame();
    const id = mkEntityId(101);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Stack);
    game.cards.set(id, card);
    new StormKeywordHandler().activate(
      { keyword: "storm" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("storm")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 30 — Ninjutsu activate stamps keyword + spell ability", () => {
  it("synthesizes a Hand-zone activated SpellAbility with handlerKey 'Ninjutsu'", () => {
    const game = mkGame();
    const id = mkEntityId(102);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new NinjutsuKeywordHandler().activate(
      { keyword: "ninjutsu", params: { cost: { kind: "literal", raw: "1 U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("ninjutsu")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.handlerKey).toBe("Ninjutsu");
    expect(sa?.activeInZones.has(ZoneType.Hand)).toBe(true);
  });
});

describe("Wave 30 — Graft activate stamps keyword + ETB-counter spec + watch trigger", () => {
  it("stamps `graft` keyword and registers a watch trigger (ETB counters via etbCounterSpecs)", () => {
    // M6.19 — Graft's "enters with N +1/+1 counters" is now a CR 614
    // replacement (etbCounterSpecs slot), not a triggered ability. Only
    // the watch trigger remains as a TriggeredAbility.
    const game = mkGame();
    const id = mkEntityId(103);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new GraftKeywordHandler().activate(
      { keyword: "graft", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("graft")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const slot = card as unknown as {
      etbCounterSpecs?: Array<{ amount: number }>;
    };
    expect(slot.etbCounterSpecs?.length).toBe(1);
    expect(slot.etbCounterSpecs?.[0]?.amount).toBe(2);
  });
});

describe("Wave 30 — Modular activate stamps keyword + ETB-counter spec + LTB trigger", () => {
  it("stamps `modular` keyword and registers an LTB trigger (ETB counters via etbCounterSpecs)", () => {
    // M6.19 — same family as Graft: Modular's ETB counters move to
    // `etbCounterSpecs`; only the LTB transfer trigger remains as a
    // TriggeredAbility.
    const game = mkGame();
    const id = mkEntityId(104);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ModularKeywordHandler().activate(
      { keyword: "modular", params: { amount: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("modular")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const slot = card as unknown as {
      etbCounterSpecs?: Array<{ amount: number }>;
    };
    expect(slot.etbCounterSpecs?.length).toBe(1);
    expect(slot.etbCounterSpecs?.[0]?.amount).toBe(3);
  });
});

describe("Wave 30 — Living Weapon activate stamps keyword + ETB trigger", () => {
  it("stamps `living_weapon` keyword and registers an ETB trigger", () => {
    const game = mkGame();
    const id = mkEntityId(105);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new LivingWeaponKeywordHandler().activate(
      { keyword: "living_weapon" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("living_weapon")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 30 — Riot activate stamps keyword + ETB trigger", () => {
  it("stamps `riot` keyword and registers an ETB trigger", () => {
    const game = mkGame();
    const id = mkEntityId(106);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new RiotKeywordHandler().activate({ keyword: "riot" }, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.keywords?.has("riot")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 30 — Rebound activate stamps keyword + cast/upkeep triggers", () => {
  it("stamps `rebound` keyword and registers two triggered abilities", () => {
    const game = mkGame();
    const id = mkEntityId(107);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new ReboundKeywordHandler().activate(
      { keyword: "rebound" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("rebound")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(2);
  });
});

void CounterType;

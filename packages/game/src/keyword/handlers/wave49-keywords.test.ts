// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 49 — smoke tests for Equip / Kicker / Multikicker / Ward keyword
// handlers. Each test exercises the durable contract of its mechanic —
// handler registration, keyword stamping, and the data-layer side
// effect (synthesized SpellAbility, registered TriggeredAbility, or
// stamped cost slot).
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
import { EquipKeywordHandler } from "./equip-keyword.js";
import { KickerKeywordHandler, MultikickerKeywordHandler } from "./kicker-keyword.js";
import { WardKeywordHandler } from "./ward-keyword.js";

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

describe("Wave 49 keyword handlers — registration", () => {
  it("EquipKeywordHandler is registered under 'equip'", () => {
    expect(keywordHandlerRegistry.has("equip")).toBe(true);
  });
  it("KickerKeywordHandler is registered under 'kicker'", () => {
    expect(keywordHandlerRegistry.has("kicker")).toBe(true);
  });
  it("MultikickerKeywordHandler is registered under 'multikicker'", () => {
    expect(keywordHandlerRegistry.has("multikicker")).toBe(true);
  });
  it("WardKeywordHandler is registered under 'ward'", () => {
    expect(keywordHandlerRegistry.has("ward")).toBe(true);
  });
});

describe("Wave 49 — Equip synthesizes a Battlefield-zone sorcery-speed Attach SA", () => {
  it("stamps `equip` keyword and pushes a Battlefield SA with handlerKey 'Attach'", () => {
    const game = mkGame();
    const id = mkEntityId(490);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new EquipKeywordHandler().activate(
      { keyword: "equip", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("equip")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(sa?.handlerKey).toBe("Attach");
    expect(sa?.tags.has("equip")).toBe(true);
    expect(sa?.tags.has("sorcery_speed")).toBe(true);
    const tgts = sa?.ast.effect.params.ValidTgts;
    expect(tgts?.kind).toBe("literal");
    expect(tgts && tgts.kind === "literal" ? tgts.raw : null).toBe("Creature.YouCtrl");
  });

  it("deactivate removes the 'equip' keyword flag", () => {
    const game = mkGame();
    const id = mkEntityId(491);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new EquipKeywordHandler();
    const ast = { keyword: "equip" as const, params: { cost: { kind: "literal" as const, raw: "2" } } };
    handler.activate(ast, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.keywords?.has("equip")).toBe(true);
    handler.deactivate?.(ast, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.keywords?.has("equip")).toBe(false);
  });
});

describe("Wave 49 — Kicker stamps `kickerCost` for the cast pipeline", () => {
  it("stamps `kicker` keyword and sets card.kickerCost", () => {
    const game = mkGame();
    const id = mkEntityId(492);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new KickerKeywordHandler().activate(
      { keyword: "kicker", params: { cost: { kind: "literal", raw: "5 R R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("kicker")).toBe(true);
    expect(card.kickerCost).toBe("5 R R");
  });

  it("deactivate clears the kicker slot and keyword flag", () => {
    const game = mkGame();
    const id = mkEntityId(493);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    const handler = new KickerKeywordHandler();
    const ast = { keyword: "kicker" as const, params: { cost: { kind: "literal" as const, raw: "R" } } };
    handler.activate(ast, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.kickerCost).toBe("R");
    handler.deactivate?.(ast, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.kickerCost).toBeUndefined();
    expect(card.keywords?.has("kicker")).toBe(false);
  });
});

describe("Wave 49 — Multikicker stamps `multikickerCost`", () => {
  it("stamps `multikicker` keyword and sets card.multikickerCost", () => {
    const game = mkGame();
    const id = mkEntityId(494);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new MultikickerKeywordHandler().activate(
      { keyword: "multikicker", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("multikicker")).toBe(true);
    expect(card.multikickerCost).toBe("2");
  });
});

describe("Wave 49 — Ward synthesizes a BecomesTarget trigger", () => {
  it("stamps `ward` keyword + `wardCost` and registers a triggered ability on Battlefield", () => {
    const game = mkGame();
    const id = mkEntityId(495);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new WardKeywordHandler().activate(
      { keyword: "ward", params: { cost: { kind: "literal", raw: "1 U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("ward")).toBe(true);
    expect(card.wardCost).toBe("1 U");
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
  });

  it("ward trigger matches CardTargeted by an opponent and ignores own targeting", () => {
    const game = mkGame();
    const id = mkEntityId(496);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new WardKeywordHandler().activate(
      { keyword: "ward", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    const ta = card.triggeredAbilities?.[0];
    expect(ta).toBeDefined();
    if (!ta) return;

    const oppEvent = {
      kind: "CardTargeted",
      payload: {
        targetId: id,
        sourceCardId: mkEntityId(497),
        targetingSeat: mkPlayerSeat(1),
      },
    };
    expect(ta.matches(oppEvent as never)).toBe(true);

    const ownEvent = {
      kind: "CardTargeted",
      payload: {
        targetId: id,
        sourceCardId: mkEntityId(498),
        targetingSeat: ALICE,
      },
    };
    expect(ta.matches(ownEvent as never)).toBe(false);

    const otherTargetEvent = {
      kind: "CardTargeted",
      payload: {
        targetId: mkEntityId(499),
        sourceCardId: mkEntityId(500),
        targetingSeat: mkPlayerSeat(1),
      },
    };
    expect(ta.matches(otherTargetEvent as never)).toBe(false);
  });

  it("ward deactivate clears keyword and wardCost", () => {
    const game = mkGame();
    const id = mkEntityId(501);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new WardKeywordHandler();
    const ast = { keyword: "ward" as const, params: { cost: { kind: "literal" as const, raw: "1" } } };
    handler.activate(ast, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.wardCost).toBe("1");
    handler.deactivate?.(ast, { game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.wardCost).toBeUndefined();
    expect(card.keywords?.has("ward")).toBe(false);
  });
});

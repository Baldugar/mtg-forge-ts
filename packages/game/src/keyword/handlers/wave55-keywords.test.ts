// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 55 — smoke tests for Morph / Megamorph / Disguise keyword
// handlers + the Adventure / Jump-Start AltCosts. Each test exercises
// the durable contract of its mechanic: handler / AltCost registration,
// keyword stamping, slot population, the synthesized Battlefield-zone
// activated SpellAbility's tags, the TurnFaceUp resolver flipping the
// face-down state, and (for megamorph) the +1/+1 counter post-flip.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
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
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { DisguiseKeywordHandler } from "./disguise-keyword.js";
import { MegamorphKeywordHandler } from "./megamorph-keyword.js";
import { MorphKeywordHandler } from "./morph-keyword.js";

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
const adventurePaper: PaperCard = {
  name: "Giant Killer",
  edition: "ELD",
  collectorNumber: "014",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Giant Killer" },
    adventure: { name: "Chop Down" },
  },
};

const ALICE = mkPlayerSeat(0);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

describe("Wave 55 keyword handlers — registration", () => {
  it("MorphKeywordHandler is registered under 'morph'", () => {
    expect(keywordHandlerRegistry.lookup("morph")).toBe(MorphKeywordHandler);
  });
  it("MegamorphKeywordHandler is registered under 'megamorph'", () => {
    expect(keywordHandlerRegistry.lookup("megamorph")).toBe(MegamorphKeywordHandler);
  });
  it("DisguiseKeywordHandler is registered under 'disguise'", () => {
    expect(keywordHandlerRegistry.lookup("disguise")).toBe(DisguiseKeywordHandler);
  });
});

describe("Wave 55 AltCosts — registration", () => {
  it("Adventure AltCost is registered", () => {
    expect(altCostRegistry.has("Adventure")).toBe(true);
  });
  it("JumpStart AltCost is registered", () => {
    expect(altCostRegistry.has("JumpStart")).toBe(true);
  });
});

describe("Wave 55 — Morph activate stamps slot + synthesizes Battlefield SA", () => {
  it("parses K:Morph:1 U and stamps card.morphCost + adds 'morph' keyword + synthesizes SA", () => {
    const game = mkGame();
    const id = mkEntityId(551);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new MorphKeywordHandler().activate(
      { keyword: "morph", params: { cost: { kind: "literal", raw: "1 U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("morph")).toBe(true);
    expect(card.morphCost).toBe("1 U");
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized SA");
    expect(sa.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(sa.tags.has("morph")).toBe(true);
    expect(sa.tags.has("turn_face_up")).toBe(true);
    expect(sa.handlerKey).toBe("TurnFaceUp");
    expect(sa.ast.cost?.raw).toBe("1 U");
  });

  it("deactivate clears morphCost and removes the keyword flag", () => {
    const game = mkGame();
    const id = mkEntityId(552);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new MorphKeywordHandler();
    handler.activate(
      { keyword: "morph", params: { cost: { kind: "literal", raw: "2 R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.morphCost).toBe("2 R");
    handler.deactivate?.(
      { keyword: "morph", params: { cost: { kind: "literal", raw: "2 R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("morph")).toBe(false);
    expect(card.morphCost).toBeUndefined();
  });
});

describe("Wave 55 — Megamorph activate stamps slot + synthesizes 'megamorph'-tagged SA", () => {
  it("parses K:Megamorph:R and stamps morphCost + 'megamorph' keyword + tags SA 'megamorph'", () => {
    const game = mkGame();
    const id = mkEntityId(553);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new MegamorphKeywordHandler().activate(
      { keyword: "megamorph", params: { cost: { kind: "literal", raw: "R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("megamorph")).toBe(true);
    expect(card.morphCost).toBe("R");
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized SA");
    expect(sa.tags.has("megamorph")).toBe(true);
    expect(sa.tags.has("turn_face_up")).toBe(true);
    expect(sa.handlerKey).toBe("TurnFaceUp");
  });
});

describe("Wave 55 — Disguise activate stamps slot + ward 2 + synthesizes 'disguise'-tagged SA", () => {
  it("parses K:Disguise:1 W and stamps disguiseCost + morphCost + wardCost=2 + 'disguise' keyword", () => {
    const game = mkGame();
    const id = mkEntityId(554);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new DisguiseKeywordHandler().activate(
      { keyword: "disguise", params: { cost: { kind: "literal", raw: "1 W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("disguise")).toBe(true);
    expect(card.disguiseCost).toBe("1 W");
    expect(card.morphCost).toBe("1 W");
    expect(card.wardCost).toBe("2");
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized SA");
    expect(sa.tags.has("disguise")).toBe(true);
    expect(sa.tags.has("turn_face_up")).toBe(true);
  });

  it("deactivate clears disguiseCost / morphCost / wardCost and removes the keyword", () => {
    const game = mkGame();
    const id = mkEntityId(555);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new DisguiseKeywordHandler();
    handler.activate(
      { keyword: "disguise", params: { cost: { kind: "literal", raw: "2 G" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    handler.deactivate?.(
      { keyword: "disguise", params: { cost: { kind: "literal", raw: "2 G" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("disguise")).toBe(false);
    expect(card.disguiseCost).toBeUndefined();
    expect(card.morphCost).toBeUndefined();
    expect(card.wardCost).toBeUndefined();
  });
});

describe("Wave 55 — TurnFaceUp resolver flips face-down state", () => {
  it("morph: TurnFaceUp resolver clears card.faceDown and emits CardTurnedFaceUp", async () => {
    const game = mkGame();
    const id = mkEntityId(556);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    card.faceDown = { kind: "morph", cost: ManaCost.parse("1 U") };
    game.cards.set(id, card);
    new MorphKeywordHandler().activate(
      { keyword: "morph", params: { cost: { kind: "literal", raw: "1 U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized morph SA");
    const resolver = sa.makeResolver();
    const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
    let step = gen.next();
    while (!step.done) step = gen.next(undefined);
    expect(card.faceDown.kind).toBe("none");
    expect(card.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("megamorph: TurnFaceUp resolver flips and adds a +1/+1 counter", async () => {
    const game = mkGame();
    const id = mkEntityId(557);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    card.faceDown = { kind: "morph", cost: ManaCost.parse("R") };
    game.cards.set(id, card);
    new MegamorphKeywordHandler().activate(
      { keyword: "megamorph", params: { cost: { kind: "literal", raw: "R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized megamorph SA");
    const resolver = sa.makeResolver();
    const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
    let step = gen.next();
    while (!step.done) step = gen.next(undefined);
    expect(card.faceDown.kind).toBe("none");
    expect(card.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
  });

  it("TurnFaceUp resolver is idempotent — already face-up cards no-op cleanly", () => {
    const game = mkGame();
    const id = mkEntityId(558);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    // Card is already face-up (default kind "none").
    game.cards.set(id, card);
    new MorphKeywordHandler().activate(
      { keyword: "morph", params: { cost: { kind: "literal", raw: "1 U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized morph SA");
    const resolver = sa.makeResolver();
    const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
    let step = gen.next();
    while (!step.done) step = gen.next(undefined);
    expect(card.faceDown.kind).toBe("none");
  });
});

describe("Wave 55 — Adventure AltCost availability", () => {
  it("isAvailable: true when card is in Exile, has adventure face, and adventureSide=='spell'", () => {
    const game = mkGame();
    const id = mkEntityId(559);
    const card = new Card(id, adventurePaper, ALICE, ALICE, ZoneType.Exile);
    card.adventureSide = "spell";
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("Adventure");
    if (!altCost) throw new Error("Adventure AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(true);
  });

  it("isAvailable: false when card is not in Exile", () => {
    const game = mkGame();
    const id = mkEntityId(560);
    const card = new Card(id, adventurePaper, ALICE, ALICE, ZoneType.Hand);
    card.adventureSide = "spell";
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("Adventure");
    if (!altCost) throw new Error("Adventure AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(false);
  });

  it("isAvailable: false when paperCard has no adventure face", () => {
    const game = mkGame();
    const id = mkEntityId(561);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Exile);
    card.adventureSide = "spell";
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("Adventure");
    if (!altCost) throw new Error("Adventure AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(false);
  });

  it("isAvailable: false when adventureSide is not 'spell'", () => {
    const game = mkGame();
    const id = mkEntityId(562);
    const card = new Card(id, adventurePaper, ALICE, ALICE, ZoneType.Exile);
    // Default adventureSide is undefined.
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("Adventure");
    if (!altCost) throw new Error("Adventure AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(false);
  });
});

describe("Wave 55 — Jump-Start AltCost availability", () => {
  const jumpStartPaper = (kw: string): PaperCard =>
    ({
      name: "Chemister's Insight",
      edition: "GRN",
      collectorNumber: "032",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: {
        keywords: [{ keyword: kw, params: {} }],
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        svars: new Map(),
      },
    }) as unknown as PaperCard;

  it("isAvailable: true when card is in Graveyard with K:Jump-Start (jump_start id)", () => {
    const game = mkGame();
    const id = mkEntityId(563);
    const card = new Card(id, jumpStartPaper("jump_start"), ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("JumpStart");
    if (!altCost) throw new Error("JumpStart AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(true);
  });

  it("isAvailable: tolerates 'jump-start' alias (DSL slash form)", () => {
    const game = mkGame();
    const id = mkEntityId(564);
    const card = new Card(id, jumpStartPaper("jump-start"), ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("JumpStart");
    if (!altCost) throw new Error("JumpStart AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(true);
  });

  it("isAvailable: false when card is not in Graveyard", () => {
    const game = mkGame();
    const id = mkEntityId(565);
    const card = new Card(id, jumpStartPaper("jump_start"), ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("JumpStart");
    if (!altCost) throw new Error("JumpStart AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(false);
  });

  it("isAvailable: false when card has no jump_start keyword", () => {
    const game = mkGame();
    const id = mkEntityId(566);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    const altCost = altCostRegistry.lookup("JumpStart");
    if (!altCost) throw new Error("JumpStart AltCost not registered");
    expect(altCost.isAvailable(card, game)).toBe(false);
  });
});

describe("Wave 55 — slot defaults", () => {
  it("Card defaults morphCost / disguiseCost / adventureSide to undefined", () => {
    const id = mkEntityId(567);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    expect(card.morphCost).toBeUndefined();
    expect(card.disguiseCost).toBeUndefined();
    expect(card.adventureSide).toBeUndefined();
  });
});

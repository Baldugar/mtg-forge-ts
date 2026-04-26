// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer, ManaCostAst, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const addCard = (g: Game, id: number) => {
  const cid = mkEntityId(id);
  const card = new Card(cid, grizzlyBears, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
  g.cards.set(cid, card);
  return cid;
};

describe("LayerEngine skeleton", () => {
  it("currentEpoch starts at 0", () => {
    const g = mkGame();
    expect(g.layerEngine.currentEpoch).toBe(0);
  });

  it("computeCharacteristics throws GameStateIntegrityError for unknown card id", () => {
    const g = mkGame();
    expect(() => g.layerEngine.computeCharacteristics(mkEntityId(9999))).toThrow(/not found/);
  });

  it("bumpEpoch increments the epoch and clears the cache", () => {
    const g = mkGame();
    const cid = addCard(g, 100);
    g.layerEngine.computeCharacteristics(cid);
    expect(g.layerEngine.getCached(cid)).toBeDefined();
    const e0 = g.layerEngine.currentEpoch;
    g.layerEngine.bumpEpoch("test");
    expect(g.layerEngine.currentEpoch).toBe(e0 + 1);
    expect(g.layerEngine.getCached(cid)).toBeUndefined();
  });

  it("computeCharacteristics caches — two calls in same epoch return same reference", () => {
    const g = mkGame();
    const cid = addCard(g, 101);
    const a = g.layerEngine.computeCharacteristics(cid);
    const b = g.layerEngine.computeCharacteristics(cid);
    expect(a).toBe(b);
  });

  it("cache invalidates on bumpEpoch — new call returns a fresh reference", () => {
    const g = mkGame();
    const cid = addCard(g, 102);
    const a = g.layerEngine.computeCharacteristics(cid);
    g.layerEngine.bumpEpoch("invalidate");
    const b = g.layerEngine.computeCharacteristics(cid);
    expect(a).not.toBe(b);
  });

  it("base characteristics reflect PaperCard.name", () => {
    const g = mkGame();
    const cid = addCard(g, 103);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.name).toBe("Grizzly Bears");
  });
});

// ---------------------------------------------------------------------------
// Task 1: deriveBaseCharacteristics reads PaperCard.definition
// ---------------------------------------------------------------------------
describe("deriveBaseCharacteristics — reads PaperCard.definition", () => {
  const mkCreaturePaper = (): PaperCard => ({
    name: "Grizzly Bears",
    edition: "LEA",
    collectorNumber: "195",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: {
      name: "Grizzly Bears",
      oracle: "",
      types: TypeLine.parse("Creature — Bear"),
      manaCost: { raw: "1G", symbols: [] } satisfies ManaCostAst,
      pt: { power: "2", toughness: "2" },
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    },
  });

  it("types are populated from definition.types", () => {
    const g = mkGame();
    const cid = mkEntityId(200);
    const card = new Card(cid, mkCreaturePaper(), mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.types.has(CardType.Creature)).toBe(true);
  });

  it("subtypes are populated from definition.types", () => {
    const g = mkGame();
    const cid = mkEntityId(201);
    const card = new Card(cid, mkCreaturePaper(), mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.subtypes.has("Bear")).toBe(true);
  });

  it("power and toughness are populated from definition.pt", () => {
    const g = mkGame();
    const cid = mkEntityId(202);
    const card = new Card(cid, mkCreaturePaper(), mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
  });

  it("manaCost is populated from definition.manaCost", () => {
    const g = mkGame();
    const cid = mkEntityId(203);
    const card = new Card(cid, mkCreaturePaper(), mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.manaCost.cmc()).toBe(2); // 1G = CMC 2
  });

  it("supertypes are populated from definition.types", () => {
    const g = mkGame();
    const cid = mkEntityId(204);
    const legendaryCreaturePaper: PaperCard = {
      name: "Rith, the Awakener",
      edition: "INV",
      collectorNumber: "206",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: {
        name: "Rith, the Awakener",
        oracle: "",
        types: TypeLine.parse("Legendary Creature — Dragon"),
        manaCost: { raw: "3RGW", symbols: [] } satisfies ManaCostAst,
        pt: { power: "6", toughness: "6" },
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [],
        svars: new Map(),
      },
    };
    const card = new Card(
      cid,
      legendaryCreaturePaper,
      mkPlayerSeat(0),
      mkPlayerSeat(0),
      ZoneType.Battlefield,
    );
    g.cards.set(cid, card);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.supertypes.has(Supertype.Legendary)).toBe(true);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.subtypes.has("Dragon")).toBe(true);
  });

  it("card without definition gets empty characteristics (graceful fallback)", () => {
    const g = mkGame();
    const cid = mkEntityId(205);
    const noDefPaper: PaperCard = {
      name: "Token",
      edition: "LEA",
      collectorNumber: "999",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    const card = new Card(cid, noDefPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.types.size).toBe(0);
    expect(chars.power).toBeNull();
    expect(chars.toughness).toBeNull();
  });

  // Audit I-16 — CR 604.3 cross-layer CDA ordering. CDAs apply within their
  // own layer (layer 4 CDA in layer 4, layer 5 CDA in layer 5, layer 7a CDA
  // for P/T). This test pins the cross-layer ordering: a Layer 4 CDA that
  // adds Creature must be visible to subsequent Layer 5 + Layer 7 effects.
  it("I-16 — Layer 4 CDA → Layer 5 + Layer 7 see the new type", () => {
    const g = mkGame();
    const cid = mkEntityId(300);
    const noDefPaper: PaperCard = {
      name: "ManLand",
      edition: "LEA",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    const card = new Card(cid, noDefPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);

    // Layer 4 CDA — make it a Creature.
    g.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: true,
      timestamp: 1,
      sourceAbilityId: null,
    });
    // Layer 7a CDA — set 1/1 (only meaningful because Layer 4 CDA made it
    // a creature; non-creatures get null P/T from base + 7a-only would still
    // set, but 7c modifications gate on null per CR 613.4b).
    g.layerEngine.pt7a.push({
      kind: "cdaSet",
      power: 1,
      toughness: 1,
      timestamp: 1,
      sourceAbilityId: null,
    });
    // Layer 7c modify (non-CDA) — +2/+0. This must apply on top of the CDA
    // 1/1, yielding 3/1.
    g.layerEngine.pt7c.push({
      kind: "modify",
      powerDelta: 2,
      toughnessDelta: 0,
      timestamp: 2,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("test-cda-cross-layer");
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.power).toBe(3);
    expect(chars.toughness).toBe(1);
  });
});

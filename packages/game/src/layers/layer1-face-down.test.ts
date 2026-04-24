// SPDX-License-Identifier: GPL-3.0-or-later
// CR 708.2 — face-down override tests (SP2 Task 53).
//
// Verifies:
//   - kind "none" leaves characteristics unchanged.
//   - each face-down kind (morph/manifest/foretell/disguise/cloak) produces
//     2/2 vanilla colorless Creature with no name/cost/abilities.
//   - face-down override applies AFTER copy effects (CR 707.11).
//   - LayerEngine integration: a Card with `faceDown.kind = morph` exposes
//     overridden characteristics through computeCharacteristics.
//   - Non-copiable state (counters, damage) is untouched.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  Supertype,
  ZoneType,
  emptyCharacteristics,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { applyFaceDownOverride } from "./layer1-face-down.js";

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
  seed: "cafebabe",
};

const paper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const mkGame = (): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xcafebaben),
  });
  seedZones(g);
  return g;
};

const addCard = (g: Game, id: number, seat: PlayerSeat): EntityId => {
  const cid = mkEntityId(id);
  const card = new Card(cid, paper, seat, seat, ZoneType.Battlefield);
  g.cards.set(cid, card);
  const z = g.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("missing battlefield");
  z.add(cid);
  g.layerEngine.bumpEpoch("seed");
  return cid;
};

describe("applyFaceDownOverride (CR 708.2) — pure function", () => {
  it("kind 'none' is a no-op", () => {
    const c = emptyCharacteristics();
    c.name = "Grizzly Bears";
    c.power = 2;
    c.toughness = 2;
    c.types.add(CardType.Creature);
    c.subtypes.add("Bear");
    c.colors = ColorSet.of(Color.Green);
    applyFaceDownOverride(c, { kind: "none" });
    expect(c.name).toBe("Grizzly Bears");
    expect(c.subtypes.has("Bear")).toBe(true);
    expect(c.colors.equals(ColorSet.of(Color.Green))).toBe(true);
  });

  it("morph produces 2/2 vanilla colorless Creature", () => {
    const c = emptyCharacteristics();
    c.name = "Akroma, Angel of Wrath";
    c.power = 6;
    c.toughness = 6;
    c.types.add(CardType.Creature);
    c.supertypes.add(Supertype.Legendary);
    c.subtypes.add("Angel");
    c.colors = ColorSet.of(Color.White);
    c.rulesText = "Flying, first strike, vigilance...";
    applyFaceDownOverride(c, { kind: "morph", cost: ManaCost.parse("3") });
    expect(c.name).toBe("");
    expect(c.power).toBe(2);
    expect(c.toughness).toBe(2);
    expect(c.types.has(CardType.Creature)).toBe(true);
    expect(c.types.size).toBe(1);
    expect(c.supertypes.size).toBe(0);
    expect(c.subtypes.size).toBe(0);
    expect(c.colors.equals(ColorSet.empty())).toBe(true);
    expect(c.rulesText).toBe("");
    expect(c.abilities).toHaveLength(0);
  });

  it("manifest override", () => {
    const c = emptyCharacteristics();
    c.power = 3;
    c.toughness = 3;
    applyFaceDownOverride(c, { kind: "manifest" });
    expect(c.power).toBe(2);
    expect(c.toughness).toBe(2);
    expect(c.types.has(CardType.Creature)).toBe(true);
  });

  it("foretell override", () => {
    const c = emptyCharacteristics();
    applyFaceDownOverride(c, { kind: "foretell", castableFrom: "exile" });
    expect(c.power).toBe(2);
    expect(c.types.has(CardType.Creature)).toBe(true);
  });

  it("disguise override (also produces 2/2 vanilla)", () => {
    const c = emptyCharacteristics();
    applyFaceDownOverride(c, { kind: "disguise", wardAmount: 3 });
    expect(c.power).toBe(2);
    expect(c.toughness).toBe(2);
    expect(c.types.has(CardType.Creature)).toBe(true);
  });

  it("cloak override", () => {
    const c = emptyCharacteristics();
    applyFaceDownOverride(c, { kind: "cloak" });
    expect(c.power).toBe(2);
    expect(c.toughness).toBe(2);
    expect(c.types.has(CardType.Creature)).toBe(true);
  });

  it("manaCost is set to Forge NO_COST", () => {
    const c = emptyCharacteristics();
    c.manaCost = ManaCost.parse("2WB");
    applyFaceDownOverride(c, { kind: "morph", cost: ManaCost.parse("3") });
    expect(c.manaCost.isNoCost()).toBe(true);
  });

  it("loyalty/defense cleared (face-down permanents are not planeswalkers/battles)", () => {
    const c = emptyCharacteristics();
    c.loyalty = 4;
    c.defense = 3;
    applyFaceDownOverride(c, { kind: "morph", cost: ManaCost.parse("3") });
    expect(c.loyalty).toBeNull();
    expect(c.defense).toBeNull();
  });
});

describe("Face-down + copy interaction (CR 707.11)", () => {
  it("copy of Grizzly Bears with faceDown morph → 2/2 colorless vanilla (override wins)", () => {
    const g = mkGame();
    const cid = addCard(g, 100, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing card");
    const source: CopiableCharacteristics = {
      name: "Grizzly Bears",
      manaCost: ManaCost.parse("1G"),
      colorIndicator: null,
      supertypes: new Set(),
      types: new Set([CardType.Creature]),
      subtypes: new Set(["Bear"]),
      colors: ColorSet.of(Color.Green),
      rulesText: "",
      power: 2,
      toughness: 2,
      loyalty: null,
      defense: null,
    };
    card.copiedFrom = source;
    card.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    g.layerEngine.bumpEpoch("test");
    const chars = g.layerEngine.computeCharacteristics(cid);
    // Override wins: name empty, colorless, no Bear subtype.
    expect(chars.name).toBe("");
    expect(chars.colors.equals(ColorSet.empty())).toBe(true);
    expect(chars.subtypes.has("Bear")).toBe(false);
    // Still a 2/2 Creature (matches the copied Grizzly Bears numerically but
    // for a different reason — override sets 2/2 regardless of source).
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
    expect(chars.types.has(CardType.Creature)).toBe(true);
  });

  it("LayerEngine.computeCharacteristics on face-up card is unaffected", () => {
    const g = mkGame();
    const cid = addCard(g, 101, mkPlayerSeat(0));
    // faceDown defaults to { kind: "none" } — no-op.
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.name).toBe("Grizzly Bears");
  });

  it("non-copiable state (damage, counters) untouched by the override", () => {
    const g = mkGame();
    const cid = addCard(g, 102, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing card");
    card.damage = 3;
    card.faceDown = { kind: "manifest" };
    g.layerEngine.bumpEpoch("test");
    g.layerEngine.computeCharacteristics(cid);
    // Card-level state — not on Characteristics.
    expect(card.damage).toBe(3);
  });
});

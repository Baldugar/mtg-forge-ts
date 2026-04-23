// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DEFAULT_PAPER_CARD_FLAGS, type PaperCard } from "../card/paper-card.js";
import { Rarity } from "../card/types.js";
import {
  type CommanderSlot,
  type Deck,
  type DeckEntry,
  DeckSection,
  NONTRADITIONAL_DECK_SECTIONS,
  deckFromJSON,
  deckSize,
  deckToJSON,
  hasSingletonViolation,
  sideboardSize,
} from "./deck.js";

const makeCard = (name: string, collectorNumber: string, rarity = Rarity.Common): PaperCard => ({
  name,
  set: "TST",
  collectorNumber,
  language: "en",
  foil: false,
  rarity,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const mountain = makeCard("Mountain", "280", Rarity.BasicLand);
const bolt = makeCard("Lightning Bolt", "161");
const shock = makeCard("Shock", "162");
const wizard = makeCard("Snapcaster Mage", "78", Rarity.Rare);

describe("DeckSection enum", () => {
  it("has all 10 Forge sections", () => {
    expect(Object.keys(DeckSection).length).toBe(10);
    expect(DeckSection.Main).toBe("Main");
    expect(DeckSection.Sideboard).toBe("Sideboard");
    expect(DeckSection.Commander).toBe("Commander");
    expect(DeckSection.Avatar).toBe("Avatar");
    expect(DeckSection.Planes).toBe("Planes");
    expect(DeckSection.Schemes).toBe("Schemes");
    expect(DeckSection.Conspiracy).toBe("Conspiracy");
    expect(DeckSection.Dungeon).toBe("Dungeon");
    expect(DeckSection.Attractions).toBe("Attractions");
    expect(DeckSection.Contraptions).toBe("Contraptions");
  });

  it("NONTRADITIONAL_DECK_SECTIONS matches Forge's 7-entry constant", () => {
    expect(NONTRADITIONAL_DECK_SECTIONS.length).toBe(7);
    expect(NONTRADITIONAL_DECK_SECTIONS).toEqual([
      DeckSection.Avatar,
      DeckSection.Planes,
      DeckSection.Schemes,
      DeckSection.Conspiracy,
      DeckSection.Dungeon,
      DeckSection.Attractions,
      DeckSection.Contraptions,
    ]);
  });
});

describe("Deck sizes", () => {
  it("empty deck has sizes 0", () => {
    const d: Deck = {
      name: "empty",
      main: [],
      sideboard: [],
      commanderSlot: { kind: "none" },
    };
    expect(deckSize(d)).toBe(0);
    expect(sideboardSize(d)).toBe(0);
  });

  it("deckSize sums counts across main", () => {
    const entries: readonly DeckEntry[] = [
      { card: mountain, count: 20 },
      { card: bolt, count: 4 },
      { card: shock, count: 4 },
    ];
    const d: Deck = {
      name: "burn",
      main: entries,
      sideboard: [],
      commanderSlot: { kind: "none" },
    };
    expect(deckSize(d)).toBe(28);
  });

  it("sideboardSize is independent from main", () => {
    const d: Deck = {
      name: "burn",
      main: [{ card: mountain, count: 20 }],
      sideboard: [{ card: bolt, count: 2 }],
      commanderSlot: { kind: "none" },
    };
    expect(deckSize(d)).toBe(20);
    expect(sideboardSize(d)).toBe(2);
  });
});

describe("CommanderSlot round-trips", () => {
  it("none", () => {
    const slot: CommanderSlot = { kind: "none" };
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
  });

  it("single", () => {
    const slot: CommanderSlot = { kind: "single", commander: wizard };
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
  });

  it("partners", () => {
    const slot: CommanderSlot = { kind: "partners", a: wizard, b: bolt };
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
  });

  it("background", () => {
    const slot: CommanderSlot = { kind: "background", commander: wizard, background: shock };
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
  });

  it("oathbreaker", () => {
    const slot: CommanderSlot = {
      kind: "oathbreaker",
      planeswalker: wizard,
      signatureSpell: bolt,
    };
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
  });
});

describe("hasSingletonViolation", () => {
  it("reports every multi-copy when no predicate is given", () => {
    const d: Deck = {
      name: "bad",
      main: [
        { card: mountain, count: 20 },
        { card: bolt, count: 4 },
        { card: wizard, count: 1 },
      ],
      sideboard: [],
      commanderSlot: { kind: "none" },
    };
    expect(hasSingletonViolation(d)).toEqual(["Mountain", "Lightning Bolt"]);
  });

  it("excludes basic lands when the predicate identifies them", () => {
    const isBasicLand = (c: PaperCard) => c.rarity === Rarity.BasicLand;
    const d: Deck = {
      name: "commander",
      main: [
        { card: mountain, count: 20 },
        { card: bolt, count: 4 },
        { card: wizard, count: 1 },
      ],
      sideboard: [],
      commanderSlot: { kind: "single", commander: wizard },
    };
    expect(hasSingletonViolation(d, isBasicLand)).toEqual(["Lightning Bolt"]);
  });

  it("returns an empty array for a fully-singleton deck", () => {
    const d: Deck = {
      name: "clean",
      main: [
        { card: bolt, count: 1 },
        { card: shock, count: 1 },
        { card: wizard, count: 1 },
      ],
      sideboard: [],
      commanderSlot: { kind: "none" },
    };
    expect(hasSingletonViolation(d)).toEqual([]);
  });
});

describe("Deck JSON round-trip", () => {
  it("preserves a realistic commander deck", () => {
    const d: Deck = {
      name: "Mono-Red Commander",
      main: [
        { card: mountain, count: 35 },
        { card: bolt, count: 1 },
        { card: shock, count: 1 },
      ],
      sideboard: [{ card: wizard, count: 1 }],
      commanderSlot: { kind: "single", commander: wizard },
      planes: [],
      dungeons: [],
    };
    const round = JSON.parse(JSON.stringify(d)) as Deck;
    expect(round).toEqual(d);
  });

  it("deckToJSON / deckFromJSON are identity helpers", () => {
    const d: Deck = {
      name: "x",
      main: [],
      sideboard: [],
      commanderSlot: { kind: "none" },
    };
    expect(deckFromJSON(deckToJSON(d))).toBe(d);
  });
});

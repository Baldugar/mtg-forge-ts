// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type DeckEntry, type FormatId, validateDeck } from "./legality.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 60 generic legal-ish basics + creatures, no bans, used as a baseline. */
function makeStandard60(): DeckEntry[] {
  return [
    { name: "Lightning Strike", count: 4 },
    { name: "Shock", count: 4 },
    { name: "Play with Fire", count: 4 },
    { name: "Burst Lightning", count: 4 },
    { name: "Phoenix Chick", count: 4 },
    { name: "Monastery Mentor", count: 4 }, // legal in Standard (it's just on Vintage's restricted list)
    { name: "Mountain", count: 36 },
  ];
}

function makeCommander99(commanderName = "Krenko, Mob Boss"): DeckEntry[] {
  // 1 commander + 99 unique-or-basic cards.
  const deck: DeckEntry[] = [
    {
      name: commanderName,
      count: 1,
      commander: true,
      colorIdentity: ["R"],
    },
  ];
  // 60 mountains (basic lands, exempt from singleton).
  deck.push({ name: "Mountain", count: 60, colorIdentity: ["R"] });
  // 39 unique non-basics with color identity {R}.
  for (let i = 0; i < 39; i++) {
    deck.push({
      name: `Goblin Token Card #${String(i)}`,
      count: 1,
      colorIdentity: ["R"],
    });
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Standard / Modern / Legacy / Pioneer (4-of, 60+, 15 sideboard)
// ---------------------------------------------------------------------------

describe("validateDeck — Standard", () => {
  it("accepts a clean 60-card deck", () => {
    const result = validateDeck(makeStandard60(), "standard");
    expect(result.legal).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags too few mainboard cards", () => {
    const deck: DeckEntry[] = [{ name: "Mountain", count: 30 }];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("at least 60"))).toBe(true);
  });

  it("flags 5x non-basic copies (over 4-of)", () => {
    const deck: DeckEntry[] = [
      { name: "Lightning Strike", count: 5 },
      { name: "Mountain", count: 56 },
    ];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Lightning Strike") && v.includes("max 4"))).toBe(true);
  });

  it("allows >4 basic lands", () => {
    const deck: DeckEntry[] = [{ name: "Mountain", count: 60 }];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(true);
  });

  it("flags banned card (Vivi Ornitier)", () => {
    const deck: DeckEntry[] = [
      ...makeStandard60().filter((e) => e.name !== "Phoenix Chick"),
      { name: "Phoenix Chick", count: 3 },
      { name: "Vivi Ornitier", count: 1 },
    ];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Banned"))).toBe(true);
  });

  it("flags >15 sideboard cards", () => {
    const deck: DeckEntry[] = [...makeStandard60(), { name: "Negate", count: 16, sideboard: true }];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Sideboard") && v.includes("at most 15"))).toBe(true);
  });

  it("counts copies across main+sideboard for 4-of cap", () => {
    const deck: DeckEntry[] = [
      { name: "Lightning Strike", count: 4 },
      { name: "Lightning Strike", count: 1, sideboard: true },
      { name: "Mountain", count: 56 },
    ];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Lightning Strike"))).toBe(true);
  });
});

describe("validateDeck — Modern", () => {
  it("accepts a clean deck", () => {
    const result = validateDeck(makeStandard60(), "modern");
    expect(result.legal).toBe(true);
  });

  it("bans Skullclamp", () => {
    const deck: DeckEntry[] = [
      { name: "Skullclamp", count: 1 },
      { name: "Mountain", count: 59 },
    ];
    const result = validateDeck(deck, "modern");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Skullclamp"))).toBe(true);
  });

  it("bans Treasure Cruise", () => {
    const deck: DeckEntry[] = [
      { name: "Treasure Cruise", count: 4 },
      { name: "Island", count: 56 },
    ];
    const result = validateDeck(deck, "modern");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Treasure Cruise"))).toBe(true);
  });
});

describe("validateDeck — Legacy", () => {
  it("bans Black Lotus", () => {
    const deck: DeckEntry[] = [
      { name: "Black Lotus", count: 1 },
      { name: "Island", count: 59 },
    ];
    const result = validateDeck(deck, "legacy");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Black Lotus"))).toBe(true);
  });

  it("accepts a clean Legacy deck", () => {
    const deck: DeckEntry[] = [
      { name: "Brainstorm", count: 4 }, // legal in Legacy
      { name: "Force of Will", count: 4 },
      { name: "Daze", count: 4 },
      { name: "Island", count: 48 },
    ];
    const result = validateDeck(deck, "legacy");
    expect(result.legal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vintage (restricted = 1-of)
// ---------------------------------------------------------------------------

describe("validateDeck — Vintage", () => {
  it("allows a single Black Lotus (restricted, 1-of)", () => {
    const deck: DeckEntry[] = [
      { name: "Black Lotus", count: 1 },
      { name: "Island", count: 59 },
    ];
    const result = validateDeck(deck, "vintage");
    expect(result.legal).toBe(true);
  });

  it("flags 2x Black Lotus (restricted)", () => {
    const deck: DeckEntry[] = [
      { name: "Black Lotus", count: 2 },
      { name: "Island", count: 58 },
    ];
    const result = validateDeck(deck, "vintage");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Restricted") && v.includes("Black Lotus"))).toBe(true);
  });

  it("flags Shahrazad (banned in Vintage)", () => {
    const deck: DeckEntry[] = [
      { name: "Shahrazad", count: 1 },
      { name: "Island", count: 59 },
    ];
    const result = validateDeck(deck, "vintage");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Banned"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pioneer
// ---------------------------------------------------------------------------

describe("validateDeck — Pioneer", () => {
  it("accepts a clean deck", () => {
    const deck: DeckEntry[] = [
      { name: "Lightning Strike", count: 4 },
      { name: "Shock", count: 4 },
      { name: "Mountain", count: 52 },
    ];
    const result = validateDeck(deck, "pioneer");
    expect(result.legal).toBe(true);
  });

  it("bans Oko, Thief of Crowns", () => {
    const deck: DeckEntry[] = [
      { name: "Oko, Thief of Crowns", count: 4 },
      { name: "Forest", count: 56 },
    ];
    const result = validateDeck(deck, "pioneer");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Oko"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pauper (commons + bans)
// ---------------------------------------------------------------------------

describe("validateDeck — Pauper", () => {
  it("accepts a clean common-only deck", () => {
    const deck: DeckEntry[] = [
      { name: "Lightning Bolt", count: 4, rarity: "C" },
      { name: "Brainstorm", count: 4, rarity: "C" },
      { name: "Counterspell", count: 4, rarity: "C" },
      { name: "Island", count: 24, rarity: "L" },
      { name: "Mountain", count: 24, rarity: "L" },
    ];
    const result = validateDeck(deck, "pauper");
    expect(result.legal).toBe(true);
  });

  it("flags rare/mythic in Pauper when rarity supplied", () => {
    const deck: DeckEntry[] = [
      { name: "Wrenn and Six", count: 1, rarity: "M" },
      { name: "Island", count: 59, rarity: "L" },
    ];
    const result = validateDeck(deck, "pauper");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Pauper allows only commons"))).toBe(true);
  });

  it("bans Treasure Cruise", () => {
    const deck: DeckEntry[] = [
      { name: "Treasure Cruise", count: 4, rarity: "C" },
      { name: "Island", count: 56, rarity: "L" },
    ];
    const result = validateDeck(deck, "pauper");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Treasure Cruise"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Commander (100-card singleton, color identity, no sideboard)
// ---------------------------------------------------------------------------

describe("validateDeck — Commander", () => {
  it("accepts a clean 100-card singleton mono-red deck", () => {
    const result = validateDeck(makeCommander99(), "commander");
    expect(result.legal).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags 99-card deck (too small)", () => {
    const deck = makeCommander99();
    deck.pop();
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Mainboard") && v.includes("100"))).toBe(true);
  });

  it("flags 101-card deck (too big)", () => {
    const deck = makeCommander99();
    deck.push({
      name: "Extra Goblin Card",
      count: 1,
      colorIdentity: ["R"],
    });
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Mainboard"))).toBe(true);
  });

  it("flags duplicate non-basic (singleton violation)", () => {
    const deck = makeCommander99();
    // Replace one unique with a 2-of of an already-present card.
    const toRemoveIdx = deck.findIndex((e) => e.name === "Goblin Token Card #0");
    deck[toRemoveIdx] = {
      name: "Goblin Token Card #1",
      count: 2,
      colorIdentity: ["R"],
    };
    // Now "Goblin Token Card #1" appears with totals 2+1=3 across deck
    // (the previously-existing entry still sits at index 1's place +1).
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Singleton violation"))).toBe(true);
  });

  it("flags missing commander", () => {
    const deck = makeCommander99().map((e) => ({ ...e, commander: false }));
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("requires a designated"))).toBe(true);
  });

  it("flags color-identity violation", () => {
    const deck = makeCommander99();
    // Add a blue-identity card to a mono-red commander deck.
    const idx = deck.findIndex((e) => e.name === "Goblin Token Card #5");
    deck[idx] = {
      name: "Counterspell",
      count: 1,
      colorIdentity: ["U"],
    };
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Color-identity violation"))).toBe(true);
  });

  it("flags banned card in Commander", () => {
    const deck = makeCommander99();
    const idx = deck.findIndex((e) => e.name === "Goblin Token Card #0");
    deck[idx] = {
      name: "Jeweled Lotus",
      count: 1,
      colorIdentity: [],
    };
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Banned") && v.includes("Jeweled Lotus"))).toBe(true);
  });

  it("flags sideboard (Commander has no sideboard)", () => {
    const deck = makeCommander99();
    deck.push({
      name: "Wishboard Card",
      count: 1,
      sideboard: true,
      colorIdentity: ["R"],
    });
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Sideboard") && v.includes("at most 0"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

describe("validateDeck — misc", () => {
  it("rejects unknown format", () => {
    const result = validateDeck([], "no-such-format" as FormatId);
    expect(result.legal).toBe(false);
  });

  it("treats card names case-insensitively for ban checks", () => {
    const deck: DeckEntry[] = [
      { name: "skullclamp", count: 1 }, // lowercase
      { name: "Mountain", count: 59 },
    ];
    const result = validateDeck(deck, "modern");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("skullclamp"))).toBe(true);
  });

  it("rejects entries with non-positive counts", () => {
    const deck: DeckEntry[] = [
      { name: "Mountain", count: 0 },
      { name: "Mountain", count: 60 },
    ];
    const result = validateDeck(deck, "standard");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.includes("Invalid count"))).toBe(true);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "../color.js";
import { DEFAULT_PAPER_CARD_FLAGS, type PaperCard, paperCardKey } from "./paper-card.js";
import { Rarity } from "./types.js";

const minimal: PaperCard = {
  name: "Lightning Bolt",
  set: "LEA",
  collectorNumber: "161",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

describe("PaperCard shape", () => {
  it("can be constructed with only the mandatory fields", () => {
    expect(minimal.name).toBe("Lightning Bolt");
    expect(minimal.set).toBe("LEA");
    expect(minimal.collectorNumber).toBe("161");
    expect(minimal.language).toBe("en");
    expect(minimal.foil).toBe(false);
    expect(minimal.flags).toEqual(DEFAULT_PAPER_CARD_FLAGS);
  });

  it("DEFAULT_PAPER_CARD_FLAGS carries null markedColors + false noSellValue", () => {
    expect(DEFAULT_PAPER_CARD_FLAGS.markedColors).toBeNull();
    expect(DEFAULT_PAPER_CARD_FLAGS.noSellValue).toBe(false);
  });

  it("accepts the Forge-ported optional fields", () => {
    const full: PaperCard = {
      ...minimal,
      artist: "Christopher Rush",
      artIndex: 2,
      rarity: Rarity.Common,
      scryfallId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      functionalVariant: "variant-a",
      flags: { ...DEFAULT_PAPER_CARD_FLAGS, noSellValue: true },
      promo: true,
      etched: true,
    };
    expect(full.artist).toBe("Christopher Rush");
    expect(full.rarity).toBe(Rarity.Common);
    expect(full.flags.noSellValue).toBe(true);
    expect(full.promo).toBe(true);
    expect(full.etched).toBe(true);
  });

  it("flags.markedColors accepts a ColorSet for Cryptic Spires-style color choices", () => {
    const marked = ColorSet.of(Color.White, Color.Blue);
    const card: PaperCard = {
      ...minimal,
      flags: { ...DEFAULT_PAPER_CARD_FLAGS, markedColors: marked },
    };
    expect(card.flags.markedColors).toBe(marked);
  });
});

describe("paperCardKey", () => {
  it("produces set:collectorNumber:lang when no disambiguators are needed", () => {
    expect(paperCardKey(minimal)).toBe("LEA:161:en");
  });

  it("appends :foil for foil printings", () => {
    expect(paperCardKey({ ...minimal, foil: true })).toBe("LEA:161:en:foil");
  });

  it("appends :aN for explicit artIndex", () => {
    expect(paperCardKey({ ...minimal, artIndex: 2 })).toBe("LEA:161:en:a2");
  });

  it("appends both :foil and :a when both apply", () => {
    expect(paperCardKey({ ...minimal, foil: true, artIndex: 3 })).toBe("LEA:161:en:foil:a3");
  });

  it("distinguishes printings that differ only on foil or artIndex", () => {
    const a = minimal;
    const b: PaperCard = { ...minimal, foil: true };
    const c: PaperCard = { ...minimal, artIndex: 1 };
    expect(paperCardKey(a)).not.toBe(paperCardKey(b));
    expect(paperCardKey(a)).not.toBe(paperCardKey(c));
    expect(paperCardKey(b)).not.toBe(paperCardKey(c));
  });

  it("treats artIndex 0 as a disambiguator", () => {
    // artIndex is optional; if a caller chooses to set it explicitly to 0, the
    // key should reflect that (it's still a distinct art from "unset").
    expect(paperCardKey({ ...minimal, artIndex: 0 })).toBe("LEA:161:en:a0");
  });
});

describe("PaperCard JSON round-trip", () => {
  it("survives JSON.stringify + JSON.parse with noSellValue + printing flags", () => {
    const full: PaperCard = {
      ...minimal,
      artist: "Christopher Rush",
      artIndex: 2,
      rarity: Rarity.Common,
      flags: { ...DEFAULT_PAPER_CARD_FLAGS, noSellValue: true },
      promo: true,
      etched: true,
    };
    const round = JSON.parse(JSON.stringify(full)) as PaperCard;
    expect(round).toEqual(full);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  CARD_TYPE_IS_PERMANENT,
  CardType,
  CoreType,
  RARITY_FILTER_OPTIONS,
  RARITY_LONG_NAME,
  Rarity,
  SPELL_TYPES,
  Supertype,
  TypeLine,
  isPermanentType,
  raritySmartValueOf,
} from "./types.js";

describe("Supertype enum", () => {
  it("has all 7 Forge entries", () => {
    expect(Object.keys(Supertype).length).toBe(7);
    expect(Supertype.Elite).toBe("Elite");
    expect(Supertype.Basic).toBe("Basic");
    expect(Supertype.Host).toBe("Host");
    expect(Supertype.Legendary).toBe("Legendary");
    expect(Supertype.Snow).toBe("Snow");
    expect(Supertype.Ongoing).toBe("Ongoing");
    expect(Supertype.World).toBe("World");
  });
});

describe("CardType enum", () => {
  it("has all 15 Forge CoreType entries with Kindred (not Tribal)", () => {
    expect(Object.keys(CardType).length).toBe(15);
    expect(CardType.Kindred).toBe("Kindred");
    // Old Forge name Tribal must not exist.
    expect((CardType as Record<string, unknown>).Tribal).toBeUndefined();
    expect((CardType as Record<string, unknown>).Emblem).toBeUndefined();
    expect((CardType as Record<string, unknown>).Hero).toBeUndefined();
  });

  it("exposes CoreType as a Forge-compatible alias", () => {
    expect(CoreType).toBe(CardType);
    expect(CoreType.Kindred).toBe(CardType.Kindred);
  });

  it("CARD_TYPE_IS_PERMANENT matches Forge's per-type boolean", () => {
    expect(CARD_TYPE_IS_PERMANENT[CardType.Creature]).toBe(true);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Land]).toBe(true);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Artifact]).toBe(true);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Enchantment]).toBe(true);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Battle]).toBe(true);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Planeswalker]).toBe(true);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Instant]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Sorcery]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Kindred]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Conspiracy]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Dungeon]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Phenomenon]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Plane]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Scheme]).toBe(false);
    expect(CARD_TYPE_IS_PERMANENT[CardType.Vanguard]).toBe(false);
  });

  it("isPermanentType agrees with the table", () => {
    expect(isPermanentType(CardType.Creature)).toBe(true);
    expect(isPermanentType(CardType.Instant)).toBe(false);
  });

  it("SPELL_TYPES contains exactly Instant and Sorcery", () => {
    expect(SPELL_TYPES.has(CardType.Instant)).toBe(true);
    expect(SPELL_TYPES.has(CardType.Sorcery)).toBe(true);
    expect(SPELL_TYPES.has(CardType.Creature)).toBe(false);
    expect(SPELL_TYPES.size).toBe(2);
  });
});

describe("Rarity enum", () => {
  it("has all 8 Forge entries with short-code values", () => {
    expect(Object.keys(Rarity).length).toBe(8);
    expect(Rarity.BasicLand).toBe("L");
    expect(Rarity.Common).toBe("C");
    expect(Rarity.Uncommon).toBe("U");
    expect(Rarity.Rare).toBe("R");
    expect(Rarity.MythicRare).toBe("M");
    expect(Rarity.Special).toBe("S");
    expect(Rarity.Token).toBe("T");
    expect(Rarity.Unknown).toBe("?");
  });

  it("RARITY_LONG_NAME matches Forge's longName values", () => {
    expect(RARITY_LONG_NAME[Rarity.MythicRare]).toBe("Mythic Rare");
    expect(RARITY_LONG_NAME[Rarity.BasicLand]).toBe("Basic Land");
    expect(RARITY_LONG_NAME[Rarity.Common]).toBe("Common");
  });

  it("RARITY_FILTER_OPTIONS is the 5-entry Forge subset", () => {
    expect(RARITY_FILTER_OPTIONS).toEqual([
      Rarity.Common,
      Rarity.Uncommon,
      Rarity.Rare,
      Rarity.MythicRare,
      Rarity.Special,
    ]);
  });

  it("smartValueOf accepts enum names, long names, and short codes case-insensitively", () => {
    expect(raritySmartValueOf("common")).toBe(Rarity.Common);
    expect(raritySmartValueOf("COMMON")).toBe(Rarity.Common);
    expect(raritySmartValueOf("C")).toBe(Rarity.Common);
    expect(raritySmartValueOf("Mythic Rare")).toBe(Rarity.MythicRare);
    expect(raritySmartValueOf("MythicRare")).toBe(Rarity.MythicRare);
    expect(raritySmartValueOf("M")).toBe(Rarity.MythicRare);
    expect(raritySmartValueOf("Basic Land")).toBe(Rarity.BasicLand);
    expect(raritySmartValueOf("L")).toBe(Rarity.BasicLand);
    expect(raritySmartValueOf("?")).toBe(Rarity.Unknown);
  });

  it("smartValueOf returns null for unknown input", () => {
    expect(raritySmartValueOf("foobar")).toBeNull();
    expect(raritySmartValueOf("")).toBeNull();
    expect(raritySmartValueOf("   ")).toBeNull();
  });
});

describe("TypeLine.parse", () => {
  it("parses a legendary enchantment creature with subtypes", () => {
    const tl = TypeLine.parse("Legendary Enchantment Creature — Human Wizard");
    expect(tl.supertypes).toEqual([Supertype.Legendary]);
    expect(tl.types).toEqual([CardType.Enchantment, CardType.Creature]);
    expect(tl.subtypes).toEqual(["Human", "Wizard"]);
  });

  it("parses a bare core type with no supertypes or subtypes", () => {
    const tl = TypeLine.parse("Artifact");
    expect(tl.supertypes).toEqual([]);
    expect(tl.types).toEqual([CardType.Artifact]);
    expect(tl.subtypes).toEqual([]);
  });

  it("parses Basic Land — Mountain", () => {
    const tl = TypeLine.parse("Basic Land — Mountain");
    expect(tl.supertypes).toEqual([Supertype.Basic]);
    expect(tl.types).toEqual([CardType.Land]);
    expect(tl.subtypes).toEqual(["Mountain"]);
  });

  it("returns an empty TypeLine for empty input", () => {
    const tl = TypeLine.parse("");
    expect(tl.supertypes).toEqual([]);
    expect(tl.types).toEqual([]);
    expect(tl.subtypes).toEqual([]);
  });

  it("throws on unknown tokens", () => {
    expect(() => TypeLine.parse("Foo")).toThrow(/Unknown card type token: Foo/);
    expect(() => TypeLine.parse("Creature Foobar")).toThrow(/Unknown card type token: Foobar/);
  });

  it("throws on multiple em-dashes", () => {
    expect(() => TypeLine.parse("Creature — Human — Wizard")).toThrow(/multiple type separators/);
  });

  it("accepts ASCII space-hyphen-space as a fallback separator", () => {
    const tl = TypeLine.parse("Creature - Human Wizard");
    expect(tl.types).toEqual([CardType.Creature]);
    expect(tl.subtypes).toEqual(["Human", "Wizard"]);
  });

  it("collapses extra whitespace on both sides", () => {
    const tl = TypeLine.parse("   Legendary   Creature   —   Elf    Druid   ");
    expect(tl.supertypes).toEqual([Supertype.Legendary]);
    expect(tl.types).toEqual([CardType.Creature]);
    expect(tl.subtypes).toEqual(["Elf", "Druid"]);
  });

  it("handles a trailing separator with no subtypes", () => {
    const tl = TypeLine.parse("Creature —");
    expect(tl.types).toEqual([CardType.Creature]);
    expect(tl.subtypes).toEqual([]);
  });
});

describe("TypeLine membership + JSON", () => {
  it("has() covers supertypes and types", () => {
    const tl = TypeLine.parse("Legendary Creature — Human");
    expect(tl.has(Supertype.Legendary)).toBe(true);
    expect(tl.has(CardType.Creature)).toBe(true);
    expect(tl.has(CardType.Artifact)).toBe(false);
    expect(tl.has(Supertype.Snow)).toBe(false);
  });

  it("hasSubtype is case-sensitive", () => {
    const tl = TypeLine.parse("Creature — Human Wizard");
    expect(tl.hasSubtype("Human")).toBe(true);
    expect(tl.hasSubtype("human")).toBe(false);
    expect(tl.hasSubtype("Wizard")).toBe(true);
    expect(tl.hasSubtype("Elf")).toBe(false);
  });

  it("isPermanent is true when any core type is a permanent", () => {
    expect(TypeLine.parse("Creature — Human").isPermanent()).toBe(true);
    expect(TypeLine.parse("Enchantment Creature — Human").isPermanent()).toBe(true);
    expect(TypeLine.parse("Instant").isPermanent()).toBe(false);
    expect(TypeLine.parse("Sorcery").isPermanent()).toBe(false);
    expect(TypeLine.parse("Kindred Instant — Elf").isPermanent()).toBe(false);
  });

  it("round-trips via toJSON / fromJSON / JSON.stringify", () => {
    const original = TypeLine.parse("Legendary Enchantment Creature — Human Wizard");
    const asJSON = original.toJSON();
    const reparsed = TypeLine.fromJSON(JSON.parse(JSON.stringify(asJSON)));
    expect(reparsed.supertypes).toEqual(original.supertypes);
    expect(reparsed.types).toEqual(original.types);
    expect(reparsed.subtypes).toEqual(original.subtypes);
  });
});

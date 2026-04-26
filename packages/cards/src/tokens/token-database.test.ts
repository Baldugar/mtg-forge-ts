// SPDX-License-Identifier: GPL-3.0-or-later
// Token database — structural tests covering the core invariants:
//   - lookup by id returns the expected entry shape
//   - missing ids return undefined
//   - every entry has consistent name + types + (pt or no pt) + colors
//   - the database is large enough to satisfy SP3's "30 most common tokens" gate
import { CardType, Color, ColorSet } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { lookupTokenScript, tokenDatabase } from "./token-database.js";

describe("tokenDatabase", () => {
  it("contains at least 30 predefined token entries", () => {
    expect(tokenDatabase.size).toBeGreaterThanOrEqual(30);
  });

  it("lookupTokenScript returns undefined for unknown ids", () => {
    expect(lookupTokenScript("not_a_real_token_id")).toBeUndefined();
    expect(tokenDatabase.get("totally_made_up")).toBeUndefined();
  });

  it("lookup w_1_1_soldier returns a 1/1 white Soldier creature", () => {
    const entry = lookupTokenScript("w_1_1_soldier");
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.id).toBe("w_1_1_soldier");
    expect(entry.name).toBe("Soldier Token");
    expect(entry.types.has(CardType.Creature)).toBe(true);
    expect(entry.types.hasSubtype("Soldier")).toBe(true);
    expect(entry.pt?.power).toBe("1");
    expect(entry.pt?.toughness).toBe("1");
    expect(entry.colors.equals(ColorSet.of(Color.White))).toBe(true);
    expect(entry.manaCost).toBeNull();
  });

  it("lookup g_1_1_saproling returns a 1/1 green Saproling", () => {
    const entry = lookupTokenScript("g_1_1_saproling");
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.types.hasSubtype("Saproling")).toBe(true);
    expect(entry.colors.equals(ColorSet.of(Color.Green))).toBe(true);
    expect(entry.pt?.power).toBe("1");
  });

  it("lookup c_1_1_a_thopter_flying returns a colorless 1/1 Thopter with Flying", () => {
    const entry = lookupTokenScript("c_1_1_a_thopter_flying");
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.types.has(CardType.Artifact)).toBe(true);
    expect(entry.types.has(CardType.Creature)).toBe(true);
    expect(entry.types.hasSubtype("Thopter")).toBe(true);
    expect(entry.colors.equals(ColorSet.empty())).toBe(true);
    expect(entry.keywords.length).toBe(1);
    expect(entry.keywords[0]?.keyword).toBe("flying");
  });

  it("lookup c_a_treasure_sac returns a colorless Treasure artifact (no PT)", () => {
    const entry = lookupTokenScript("c_a_treasure_sac");
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.types.has(CardType.Artifact)).toBe(true);
    expect(entry.types.hasSubtype("Treasure")).toBe(true);
    expect(entry.pt).toBeUndefined();
    expect(entry.colors.equals(ColorSet.empty())).toBe(true);
    expect(entry.oracle).toMatch(/any color/i);
  });

  it("lookup w_2_2_knight_vigilance carries the Vigilance keyword", () => {
    const entry = lookupTokenScript("w_2_2_knight_vigilance");
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.pt?.power).toBe("2");
    expect(entry.pt?.toughness).toBe("2");
    expect(entry.keywords.length).toBe(1);
    expect(entry.keywords[0]?.keyword).toBe("vigilance");
  });

  it("lookup wb_1_1_human_cleric is multicolor white-black", () => {
    const entry = lookupTokenScript("wb_1_1_human_cleric");
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.colors.equals(ColorSet.of(Color.White, Color.Black))).toBe(true);
    expect(entry.types.hasSubtype("Human")).toBe(true);
    expect(entry.types.hasSubtype("Cleric")).toBe(true);
  });

  it("every entry has manaCost null and an id matching its key", () => {
    for (const [id, entry] of tokenDatabase) {
      expect(entry.id).toBe(id);
      expect(entry.manaCost).toBeNull();
      expect(entry.name.length).toBeGreaterThan(0);
      // Entries with PT must be creatures; entries without PT must not be.
      if (entry.pt !== undefined) {
        expect(entry.types.has(CardType.Creature)).toBe(true);
      } else {
        expect(entry.types.has(CardType.Creature)).toBe(false);
      }
    }
  });
});

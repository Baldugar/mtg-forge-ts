// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { CardType, Supertype } from "../card/index.js";
import { Color, ColorSet } from "../color.js";
import { ManaCost } from "../mana/index.js";
import { type Characteristics, emptyCharacteristics } from "./characteristics.js";

describe("emptyCharacteristics", () => {
  it("returns a baseline with empty sets / null P/T / no abilities", () => {
    const c: Characteristics = emptyCharacteristics();
    expect(c.name).toBe("");
    // WHY: ManaCost has no toString() in SP1; observable "empty" surface is
    // zero symbols AND the Forge NO_COST flag set (parse("") convention).
    expect(c.manaCost).toBeInstanceOf(ManaCost);
    expect(c.manaCost.symbols).toEqual([]);
    expect(c.manaCost.hasNoCost).toBe(true);
    expect(c.colorIndicator).toBeNull();
    expect([...c.supertypes]).toEqual([]);
    expect([...c.types]).toEqual([]);
    expect([...c.subtypes]).toEqual([]);
    expect(c.colors.equals(ColorSet.empty())).toBe(true);
    expect(c.rulesText).toBe("");
    expect(c.power).toBeNull();
    expect(c.toughness).toBeNull();
    expect(c.loyalty).toBeNull();
    expect(c.defense).toBeNull();
    expect(c.abilities).toEqual([]);
  });

  it("returned supertypes/types/subtypes sets are independent per call (no shared mutation)", () => {
    const a = emptyCharacteristics();
    const b = emptyCharacteristics();
    a.supertypes.add(Supertype.Legendary);
    a.types.add(CardType.Creature);
    a.subtypes.add("Human");
    expect(b.supertypes.size).toBe(0);
    expect(b.types.size).toBe(0);
    expect(b.subtypes.size).toBe(0);
  });

  it("returned abilities array is independent per call (no shared mutation)", () => {
    // WHY: same hazard as the sets — if emptyCharacteristics() leaked a shared
    // array, LayerEngine's per-card state would cross-contaminate.
    const a = emptyCharacteristics();
    const b = emptyCharacteristics();
    a.abilities.push({ id: 1 as never, grantedBy: null, origin: "intrinsic" });
    expect(b.abilities).toHaveLength(0);
  });

  it("colors field supports ColorSet algebra", () => {
    const c = emptyCharacteristics();
    c.colors = c.colors.union(ColorSet.of(Color.Blue));
    expect(c.colors.has(Color.Blue)).toBe(true);
  });
});

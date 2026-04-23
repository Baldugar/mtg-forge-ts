// SPDX-License-Identifier: GPL-3.0-or-later
import { CardType, Color, ColorSet, ManaCost, emptyCharacteristics } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
import { applyLayer1Copy } from "./layer1-copy.js";

const mkSource = (overrides: Partial<CopiableCharacteristics> = {}): CopiableCharacteristics => ({
  name: "Llanowar Elves",
  manaCost: ManaCost.parse("G"),
  colorIndicator: null,
  supertypes: new Set(),
  types: new Set([CardType.Creature]),
  subtypes: new Set(["Elf", "Druid"]),
  colors: ColorSet.of(Color.Green),
  rulesText: "{T}: Add {G}.",
  power: 1,
  toughness: 1,
  loyalty: null,
  defense: null,
  ...overrides,
});

describe("Layer 1 — Copy effects (CR 613.1a)", () => {
  it("null source leaves target unchanged", () => {
    const c = emptyCharacteristics();
    c.name = "Original";
    c.rulesText = "Original text";
    applyLayer1Copy(c, null);
    expect(c.name).toBe("Original");
    expect(c.rulesText).toBe("Original text");
  });

  it("overwrites copiable values per CR 707.2", () => {
    const c = emptyCharacteristics();
    c.name = "Clone";
    applyLayer1Copy(c, mkSource());
    expect(c.name).toBe("Llanowar Elves");
    expect(c.types.has(CardType.Creature)).toBe(true);
    expect(c.subtypes.has("Elf")).toBe(true);
    expect(c.subtypes.has("Druid")).toBe(true);
    expect(c.power).toBe(1);
    expect(c.toughness).toBe(1);
    expect(c.rulesText).toBe("{T}: Add {G}.");
    expect(c.colors.equals(ColorSet.of(Color.Green))).toBe(true);
  });

  it("copies are independent Sets (target can be mutated without affecting source's ReadonlySet view)", () => {
    const src = mkSource();
    const c = emptyCharacteristics();
    applyLayer1Copy(c, src);
    c.types.add(CardType.Artifact); // legal because target.types is mutable Set
    expect(src.types.has(CardType.Artifact)).toBe(false);
  });

  it("does not touch target.abilities (non-copiable, handled by Layer 6)", () => {
    const c = emptyCharacteristics();
    // Simulate a pre-populated abilities array (hypothetical intrinsic ref).
    c.abilities.push({
      id: 99 as unknown as import("@mtg-forge-ts/core").EntityId,
      grantedBy: null,
      origin: "intrinsic",
    });
    applyLayer1Copy(c, mkSource());
    expect(c.abilities).toHaveLength(1);
  });

  it("overwrites power/toughness even when null on target", () => {
    const c = emptyCharacteristics();
    expect(c.power).toBeNull();
    applyLayer1Copy(c, mkSource({ power: 5, toughness: 5 }));
    expect(c.power).toBe(5);
    expect(c.toughness).toBe(5);
  });

  it("overwrites power/toughness TO null if source has null (e.g. copying a noncreature)", () => {
    const c = emptyCharacteristics();
    c.power = 3;
    c.toughness = 3;
    applyLayer1Copy(c, mkSource({ power: null, toughness: null, types: new Set([CardType.Artifact]) }));
    expect(c.power).toBeNull();
    expect(c.toughness).toBeNull();
  });

  it("copies loyalty and defense when set", () => {
    const c = emptyCharacteristics();
    applyLayer1Copy(
      c,
      mkSource({ loyalty: 4, defense: 3, types: new Set([CardType.Planeswalker, CardType.Battle]) }),
    );
    expect(c.loyalty).toBe(4);
    expect(c.defense).toBe(3);
  });
});

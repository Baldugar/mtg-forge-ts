// SPDX-License-Identifier: GPL-3.0-or-later
import { emptyCharacteristics } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { type TextSubstitution, applyLayer3Text } from "./layer3-text.js";

describe("Layer 3 — Text-changing effects (CR 613.1c)", () => {
  it("substitutes a single word", () => {
    const c = emptyCharacteristics();
    c.rulesText = "Each creature gets +1/+0.";
    applyLayer3Text(c, [{ from: "creature", to: "Elf", timestamp: 1 }]);
    expect(c.rulesText).toBe("Each Elf gets +1/+0.");
  });

  it("applies substitutions in timestamp order", () => {
    const c = emptyCharacteristics();
    c.rulesText = "Mountains are Islands are Mountains.";
    const subs: TextSubstitution[] = [
      { from: "Mountains", to: "Forests", timestamp: 1 },
      { from: "Islands", to: "Plains", timestamp: 2 },
    ];
    applyLayer3Text(c, subs);
    expect(c.rulesText).toBe("Forests are Plains are Forests.");
  });

  it("empty substitution list = unchanged", () => {
    const c = emptyCharacteristics();
    c.rulesText = "Target creature dies.";
    applyLayer3Text(c, []);
    expect(c.rulesText).toBe("Target creature dies.");
  });

  it("word-boundary matching does NOT replace inside larger tokens", () => {
    const c = emptyCharacteristics();
    c.rulesText = "Creatures and mini-creatures.";
    applyLayer3Text(c, [{ from: "Creatures", to: "Beasts", timestamp: 1 }]);
    expect(c.rulesText).toBe("Beasts and mini-creatures.");
  });

  it("escapes regex metacharacters in the from pattern", () => {
    const c = emptyCharacteristics();
    c.rulesText = "Cost is {2}.";
    applyLayer3Text(c, [{ from: "{2}", to: "{1}", timestamp: 1 }]);
    expect(c.rulesText).toBe("Cost is {1}.");
  });

  it("unsorted input is sorted internally (timestamps determine order, not array index)", () => {
    const c = emptyCharacteristics();
    c.rulesText = "A B A.";
    applyLayer3Text(c, [
      { from: "A", to: "C", timestamp: 2 },
      { from: "C", to: "D", timestamp: 1 },
    ]);
    // Timestamp 1 fires first (C→D, nothing matches), then 2 (A→C).
    // Result: "C B C."
    expect(c.rulesText).toBe("C B C.");
  });
});

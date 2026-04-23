// SPDX-License-Identifier: GPL-3.0-or-later
import { Color, ColorSet, emptyCharacteristics } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { applyLayer5Color } from "./layer5-color.js";

describe("Layer 5 — Color-changing effects (CR 613.1e + CR 604.3)", () => {
  it("set replaces the color set", () => {
    const c = emptyCharacteristics();
    c.colors = ColorSet.of(Color.Red);
    applyLayer5Color(c, [
      { kind: "set", colors: ColorSet.of(Color.White), isCda: false, timestamp: 1, sourceAbilityId: null },
    ]);
    expect(c.colors.equals(ColorSet.of(Color.White))).toBe(true);
  });

  it("add unions colors on top of existing", () => {
    const c = emptyCharacteristics();
    c.colors = ColorSet.of(Color.White);
    applyLayer5Color(c, [
      { kind: "add", colors: ColorSet.of(Color.Blue), isCda: false, timestamp: 1, sourceAbilityId: null },
    ]);
    expect(c.colors.has(Color.White)).toBe(true);
    expect(c.colors.has(Color.Blue)).toBe(true);
  });

  it("remove strips the given color bits", () => {
    const c = emptyCharacteristics();
    c.colors = ColorSet.of(Color.White, Color.Blue, Color.Black);
    applyLayer5Color(c, [
      { kind: "remove", colors: ColorSet.of(Color.Blue), isCda: false, timestamp: 1, sourceAbilityId: null },
    ]);
    expect(c.colors.has(Color.White)).toBe(true);
    expect(c.colors.has(Color.Blue)).toBe(false);
    expect(c.colors.has(Color.Black)).toBe(true);
  });

  it("CDA applies before non-CDA regardless of timestamp", () => {
    const c = emptyCharacteristics();
    applyLayer5Color(c, [
      { kind: "set", colors: ColorSet.of(Color.Red), isCda: false, timestamp: 1, sourceAbilityId: null },
      { kind: "set", colors: ColorSet.of(Color.Green), isCda: true, timestamp: 99, sourceAbilityId: null },
    ]);
    // CDA ts=99 applies first (Green); then non-CDA ts=1 (Red) wins.
    expect(c.colors.equals(ColorSet.of(Color.Red))).toBe(true);
  });

  it("empty effects leaves target unchanged", () => {
    const c = emptyCharacteristics();
    c.colors = ColorSet.of(Color.Red);
    applyLayer5Color(c, []);
    expect(c.colors.equals(ColorSet.of(Color.Red))).toBe(true);
  });

  it("add then remove in timestamp order", () => {
    const c = emptyCharacteristics();
    applyLayer5Color(c, [
      { kind: "add", colors: ColorSet.of(Color.Red), isCda: false, timestamp: 1, sourceAbilityId: null },
      { kind: "remove", colors: ColorSet.of(Color.Red), isCda: false, timestamp: 2, sourceAbilityId: null },
    ]);
    expect(c.colors.equals(ColorSet.empty())).toBe(true);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "./color.js";

describe("ColorSet", () => {
  it("empty set has no colors", () => {
    const empty = ColorSet.empty();
    expect(empty.has(Color.White)).toBe(false);
    expect(empty.size).toBe(0);
  });

  it("single-color set", () => {
    const s = ColorSet.of(Color.Red);
    expect(s.has(Color.Red)).toBe(true);
    expect(s.has(Color.Blue)).toBe(false);
    expect(s.size).toBe(1);
  });

  it("union + intersect + subset", () => {
    const wu = ColorSet.of(Color.White, Color.Blue);
    const ub = ColorSet.of(Color.Blue, Color.Black);
    expect(wu.union(ub).size).toBe(3);
    expect(wu.intersect(ub).equals(ColorSet.of(Color.Blue))).toBe(true);
    expect(ColorSet.of(Color.White).isSubsetOf(wu)).toBe(true);
  });

  it("toJSON round-trip", () => {
    const s = ColorSet.of(Color.Red, Color.Green, Color.Blue);
    expect(ColorSet.fromJSON(s.toJSON()).equals(s)).toBe(true);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "./color.js";

describe("Color enum", () => {
  it("contains exactly the five WUBRG bits (no Colorless)", () => {
    const values = Object.values(Color).filter((v): v is number => typeof v === "number");
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 4, 8, 16]);
  });
});

describe("ColorSet", () => {
  it("empty set has no colors (represents Forge's MagicColor.COLORLESS = 0)", () => {
    const empty = ColorSet.empty();
    expect(empty.has(Color.White)).toBe(false);
    expect(empty.size).toBe(0);
    expect(empty.toJSON()).toBe(0);
  });

  it("all() is WUBRG (size 5)", () => {
    const all = ColorSet.all();
    expect(all.size).toBe(5);
    expect(all.has(Color.White)).toBe(true);
    expect(all.has(Color.Blue)).toBe(true);
    expect(all.has(Color.Black)).toBe(true);
    expect(all.has(Color.Red)).toBe(true);
    expect(all.has(Color.Green)).toBe(true);
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

  it("fromJSON(0) yields Forge-compatible colorless (empty) set", () => {
    const cs = ColorSet.fromJSON(0);
    expect(cs.size).toBe(0);
    expect(cs.equals(ColorSet.empty())).toBe(true);
  });

  it("fromJSON(0x1F) accepts the full WUBRG mask", () => {
    const cs = ColorSet.fromJSON(0x1f);
    expect(cs.size).toBe(5);
  });

  it("fromJSON(0xFF) throws RangeError mentioning the offending value", () => {
    expect(() => ColorSet.fromJSON(0xff)).toThrow(RangeError);
    expect(() => ColorSet.fromJSON(0xff)).toThrow(/255/);
  });

  it("fromJSON(32) throws (bit 32 is ManaAtom.COLORLESS in Forge, not a color)", () => {
    expect(() => ColorSet.fromJSON(32)).toThrow(RangeError);
    expect(() => ColorSet.fromJSON(32)).toThrow(/32/);
  });

  it("fromJSON rejects negative and non-integer inputs", () => {
    expect(() => ColorSet.fromJSON(-1)).toThrow(RangeError);
    expect(() => ColorSet.fromJSON(1.5)).toThrow(RangeError);
  });
});

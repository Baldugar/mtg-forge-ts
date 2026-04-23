// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color, ColorSet } from "../color.js";
import { ManaCost, manaValue } from "./cost.js";
import type { ManaSymbol } from "./symbol.js";

describe("ManaCost.cmc()", () => {
  it("empty cost has cmc 0", () => {
    expect(ManaCost.parse("").cmc()).toBe(0);
  });

  it("single colored symbol has cmc 1", () => {
    expect(ManaCost.parse("W").cmc()).toBe(1);
  });

  it("generic N contributes N", () => {
    expect(ManaCost.parse("3").cmc()).toBe(3);
    expect(ManaCost.parse("10").cmc()).toBe(10);
    expect(ManaCost.parse("0").cmc()).toBe(0);
  });

  it("2WU has cmc 4", () => {
    expect(ManaCost.parse("2WU").cmc()).toBe(4);
  });

  it("variable X defaults to 0, and uses xValue when supplied", () => {
    const c = ManaCost.parse("XWU");
    expect(c.cmc()).toBe(2); // X=0 + W + U
    expect(c.cmc(3)).toBe(5); // X=3 + W + U
  });

  it("all X/Y/Z share the same xValue (documented simplification)", () => {
    const c = ManaCost.parse("XYZ");
    expect(c.cmc(2)).toBe(6);
  });

  it("hybrid contributes 1", () => {
    expect(ManaCost.parse("W/U").cmc()).toBe(1);
  });

  it("monoHybrid contributes 2", () => {
    expect(ManaCost.parse("2/W").cmc()).toBe(2);
    // Twin-cost like 2/W 2/U: cmc should be 4.
    expect(ManaCost.parse("2/W2/U").cmc()).toBe(4);
  });

  it("phyrexian contributes 1", () => {
    expect(ManaCost.parse("W/P").cmc()).toBe(1);
  });

  it("colorless and snow contribute 1 each", () => {
    expect(ManaCost.parse("C").cmc()).toBe(1);
    expect(ManaCost.parse("S").cmc()).toBe(1);
    expect(ManaCost.parse("CS").cmc()).toBe(2);
  });

  it("manaValue() helper matches cmc()", () => {
    const c = ManaCost.parse("XWU");
    expect(manaValue(c)).toBe(c.cmc());
    expect(manaValue(c, 5)).toBe(c.cmc(5));
  });
});

describe("ManaCost.colors()", () => {
  it("empty cost has no colors", () => {
    const c = ManaCost.parse("");
    expect(c.colors().equals(ColorSet.empty())).toBe(true);
  });

  it("purely generic has no colors", () => {
    expect(ManaCost.parse("3").colors().equals(ColorSet.empty())).toBe(true);
  });

  it("colorless and snow contribute no colors", () => {
    expect(ManaCost.parse("CS").colors().equals(ColorSet.empty())).toBe(true);
  });

  it("variable contributes no colors", () => {
    expect(ManaCost.parse("X").colors().equals(ColorSet.empty())).toBe(true);
  });

  it("single colored symbol", () => {
    const s = ManaCost.parse("W").colors();
    expect(s.equals(ColorSet.of(Color.White))).toBe(true);
  });

  it("multiple colored symbols union", () => {
    const s = ManaCost.parse("2WU").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue))).toBe(true);
  });

  it("hybrid adds both colors", () => {
    const s = ManaCost.parse("W/U").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue))).toBe(true);
  });

  it("monoHybrid adds the single color", () => {
    const s = ManaCost.parse("2/R").colors();
    expect(s.equals(ColorSet.of(Color.Red))).toBe(true);
  });

  it("phyrexian adds its color", () => {
    const s = ManaCost.parse("G/P").colors();
    expect(s.equals(ColorSet.of(Color.Green))).toBe(true);
  });

  it("mixed cost unions every color source", () => {
    // 1 + W + U/B + 2/R + G/P → colors W,U,B,R,G
    const s = ManaCost.parse("1WU/B2/RG/P").colors();
    expect(s.equals(ColorSet.of(Color.White, Color.Blue, Color.Black, Color.Red, Color.Green))).toBe(true);
  });

  it("duplicate color contributions are idempotent", () => {
    const s = ManaCost.parse("WWW").colors();
    expect(s.equals(ColorSet.of(Color.White))).toBe(true);
    expect(s.size).toBe(1);
  });
});

describe("ManaCost toJSON/fromJSON round-trip", () => {
  it("round-trips a complex cost via plain JSON", () => {
    const original = ManaCost.parse("{X}{2}{W}{U/B}{2/R}{G/P}{C}{S}");
    const json = JSON.parse(JSON.stringify(original.toJSON())) as {
      symbols: ManaSymbol[];
    };
    const restored = ManaCost.fromJSON(json);
    expect(restored.symbols).toEqual(original.symbols);
    expect(restored.cmc(3)).toBe(original.cmc(3));
    expect(restored.colors().equals(original.colors())).toBe(true);
  });

  it("toJSON returns a detached copy (mutating it does not mutate the cost)", () => {
    const c = ManaCost.parse("2WU");
    const j = c.toJSON();
    j.symbols.push({ kind: "colored", color: Color.Red });
    expect(c.symbols.length).toBe(3);
  });

  it("fromJSON preserves hybrid ordering (a,b)", () => {
    const c = ManaCost.parse("U/W");
    const restored = ManaCost.fromJSON(c.toJSON());
    expect(restored.symbols[0]).toEqual<ManaSymbol>({
      kind: "hybrid",
      a: Color.Blue,
      b: Color.White,
    });
  });

  it("empty cost round-trips", () => {
    const c = ManaCost.parse("");
    const restored = ManaCost.fromJSON(c.toJSON());
    expect(restored.symbols).toEqual([]);
    expect(restored.cmc()).toBe(0);
  });
});

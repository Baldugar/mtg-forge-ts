// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color } from "../color.js";
import { ManaCost } from "./cost.js";
import { ManaParseError, type ManaSymbol } from "./symbol.js";

describe("ManaCost.parse — basic symbols", () => {
  it("parses empty string as a no-cost (hasNoCost=true, zero symbols)", () => {
    const c = ManaCost.parse("");
    expect(c.symbols).toEqual([]);
    expect(c.hasNoCost).toBe(true);
    expect(c.isNoCost()).toBe(true);
  });

  it('parses "2WU" as generic 2, White, Blue', () => {
    const c = ManaCost.parse("2WU");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
    expect(c.hasNoCost).toBe(false);
  });

  it('parses "X1B" as variable X, generic 1, Black', () => {
    const c = ManaCost.parse("X1B");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "variable", letter: "X" },
      { kind: "generic", amount: 1 },
      { kind: "colored", color: Color.Black },
    ]);
  });

  it("parses multi-digit generic cost like 10", () => {
    const c = ManaCost.parse("10");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "generic", amount: 10 }]);
  });

  it('parses "0" as generic 0 (distinct from no-cost)', () => {
    const c = ManaCost.parse("0");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "generic", amount: 0 }]);
    expect(c.hasNoCost).toBe(false);
    expect(c.isNoCost()).toBe(false);
    expect(c.isZero()).toBe(true);
  });

  it('parses "C" as colorless', () => {
    const c = ManaCost.parse("C");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "colorless" }]);
  });

  it('parses "S" as snow', () => {
    const c = ManaCost.parse("S");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "snow" }]);
  });

  it("parses each mono-color letter", () => {
    expect(ManaCost.parse("W").symbols).toEqual<ManaSymbol[]>([{ kind: "colored", color: Color.White }]);
    expect(ManaCost.parse("U").symbols).toEqual<ManaSymbol[]>([{ kind: "colored", color: Color.Blue }]);
    expect(ManaCost.parse("B").symbols).toEqual<ManaSymbol[]>([{ kind: "colored", color: Color.Black }]);
    expect(ManaCost.parse("R").symbols).toEqual<ManaSymbol[]>([{ kind: "colored", color: Color.Red }]);
    expect(ManaCost.parse("G").symbols).toEqual<ManaSymbol[]>([{ kind: "colored", color: Color.Green }]);
  });

  it("parses Y and Z as variable letters", () => {
    expect(ManaCost.parse("Y").symbols).toEqual<ManaSymbol[]>([{ kind: "variable", letter: "Y" }]);
    expect(ManaCost.parse("Z").symbols).toEqual<ManaSymbol[]>([{ kind: "variable", letter: "Z" }]);
  });
});

describe("ManaCost.parse — compound symbols (slash)", () => {
  it('parses "W/U" as hybrid White/Blue preserving order', () => {
    const c = ManaCost.parse("W/U");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "hybrid", a: Color.White, b: Color.Blue }]);
  });

  it('parses "U/W" as hybrid Blue/White preserving order', () => {
    const c = ManaCost.parse("U/W");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "hybrid", a: Color.Blue, b: Color.White }]);
  });

  it('parses "2/W" as monoHybrid', () => {
    const c = ManaCost.parse("2/W");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "monoHybrid", generic: 2, color: Color.White }]);
  });

  it('parses "W/P" as phyrexian', () => {
    const c = ManaCost.parse("W/P");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "phyrexian", color: Color.White }]);
  });

  it('parses "C/W" as colorlessHybrid White', () => {
    const c = ManaCost.parse("C/W");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "colorlessHybrid", color: Color.White }]);
  });

  it('parses "C/G" as colorlessHybrid Green', () => {
    const c = ManaCost.parse("C/G");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "colorlessHybrid", color: Color.Green }]);
  });

  it('parses "W/U/P" as hybridPhyrexian White/Blue', () => {
    const c = ManaCost.parse("W/U/P");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "hybridPhyrexian", a: Color.White, b: Color.Blue }]);
  });

  it('parses "B/G/P" as hybridPhyrexian Black/Green', () => {
    const c = ManaCost.parse("B/G/P");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "hybridPhyrexian", a: Color.Black, b: Color.Green }]);
  });

  it("parses mixed compound and simple symbols", () => {
    const c = ManaCost.parse("2W/UB");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "hybrid", a: Color.White, b: Color.Blue },
      { kind: "colored", color: Color.Black },
    ]);
  });
});

describe("ManaCost.parse — braced form", () => {
  it('parses "{2}{W}{U}" equivalently to "2WU"', () => {
    const braced = ManaCost.parse("{2}{W}{U}");
    const unbraced = ManaCost.parse("2WU");
    expect(braced.symbols).toEqual(unbraced.symbols);
  });

  it('parses "{W/U}{2/R}{G/P}{X}{10}{C}{S}" with compound symbols braced', () => {
    const c = ManaCost.parse("{W/U}{2/R}{G/P}{X}{10}{C}{S}");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "hybrid", a: Color.White, b: Color.Blue },
      { kind: "monoHybrid", generic: 2, color: Color.Red },
      { kind: "phyrexian", color: Color.Green },
      { kind: "variable", letter: "X" },
      { kind: "generic", amount: 10 },
      { kind: "colorless" },
      { kind: "snow" },
    ]);
  });

  it('parses braced colorlessHybrid "{C/W}" and hybridPhyrexian "{W/U/P}"', () => {
    const c = ManaCost.parse("{C/W}{W/U/P}");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "colorlessHybrid", color: Color.White },
      { kind: "hybridPhyrexian", a: Color.White, b: Color.Blue },
    ]);
  });

  it("rejects a mixed braced/unbraced form", () => {
    expect(() => ManaCost.parse("{W}U")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W{U}")).toThrow(ManaParseError);
  });

  it("rejects malformed brace sequences", () => {
    expect(() => ManaCost.parse("{W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{}")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("{{W}")).toThrow(ManaParseError);
  });
});

describe("ManaCost.parse — Forge canonical space-separated form", () => {
  it('parses "2 W U" identically to "2WU"', () => {
    const spaced = ManaCost.parse("2 W U");
    const contig = ManaCost.parse("2WU");
    expect(spaced.symbols).toEqual(contig.symbols);
    expect(spaced.hasNoCost).toBe(false);
  });

  it('parses "X W U" identically to "XWU"', () => {
    const spaced = ManaCost.parse("X W U");
    expect(spaced.symbols).toEqual<ManaSymbol[]>([
      { kind: "variable", letter: "X" },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });

  it('parses "3 G/P" as generic 3 + phyrexian Green', () => {
    const c = ManaCost.parse("3 G/P");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 3 },
      { kind: "phyrexian", color: Color.Green },
    ]);
  });

  it('parses "W/U W/B" as two hybrid shards', () => {
    const c = ManaCost.parse("W/U W/B");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "hybrid", a: Color.White, b: Color.Blue },
      { kind: "hybrid", a: Color.White, b: Color.Black },
    ]);
  });

  it('parses "W/U/P B/G/P" as two hybridPhyrexian shards', () => {
    const c = ManaCost.parse("W/U/P B/G/P");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "hybridPhyrexian", a: Color.White, b: Color.Blue },
      { kind: "hybridPhyrexian", a: Color.Black, b: Color.Green },
    ]);
  });

  it('parses "{2} {W} {U}" (space-separated + braces)', () => {
    const c = ManaCost.parse("{2} {W} {U}");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });

  it("collapses runs of whitespace (tab/space)", () => {
    const c = ManaCost.parse("2\tW  U");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });

  it("rejects unknown shard token in space-separated form", () => {
    expect(() => ManaCost.parse("2 Q")).toThrow(ManaParseError);
  });

  it("rejects truly malformed tokens in space-separated form", () => {
    // Forge's parseNonGeneric is bit-accumulative and silently ignores '/',
    // so "W/" actually resolves to White (a lone color bit); matching that
    // behavior here. But an unknown alpha character MUST be rejected.
    expect(() => ManaCost.parse("2 Zz")).toThrow(ManaParseError);
    // An empty braced token is invalid.
    expect(() => ManaCost.parse("2 {}")).toThrow(ManaParseError);
  });
});

describe("ManaCost.parse — whitespace handling", () => {
  it("trims leading and trailing whitespace", () => {
    const c = ManaCost.parse("  2WU  ");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });

  it("interior whitespace selects Forge canonical form, not an error", () => {
    // Historically "2 WU" and "W U" were rejected; we now route them through
    // the space-separated parser to match Forge's ManaCostParser. In Forge
    // canonical form, each whitespace-delimited token is exactly one shard —
    // so "2 WU" is generic 2 + hybrid WU, not 2+W+U. The explicit "2 W U"
    // form is required to get three separate tokens.
    expect(ManaCost.parse("2 WU").symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "hybrid", a: Color.White, b: Color.Blue },
    ]);
    expect(ManaCost.parse("W U").symbols).toEqual<ManaSymbol[]>([
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });
});

describe("ManaCost.parse — error cases", () => {
  it("rejects unknown letters", () => {
    expect(() => ManaCost.parse("Q")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("2WQ")).toThrow(ManaParseError);
  });

  it("rejects malformed hybrid sequences", () => {
    expect(() => ManaCost.parse("W/")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("/W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W//U")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("/")).toThrow(ManaParseError);
  });

  it("rejects numbers with leading zero (other than 0 itself)", () => {
    expect(() => ManaCost.parse("01")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("001")).toThrow(ManaParseError);
  });

  it("rejects negative or non-numeric generic numbers", () => {
    expect(() => ManaCost.parse("-1")).toThrow(ManaParseError);
  });

  it("rejects invalid hybrid combos (non-color on either side)", () => {
    expect(() => ManaCost.parse("2/2")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("3/W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W/Q")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("P/W")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("X/W")).toThrow(ManaParseError);
  });

  it("echoes the full input when throwing", () => {
    try {
      ManaCost.parse("2WQ");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManaParseError);
      // The wrapper message always includes the original text.
      expect((e as Error).message).toContain('"2WQ"');
    }
  });

  it("ManaParseError is an Error subclass", () => {
    try {
      ManaCost.parse("Q");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManaParseError);
      expect(e).toBeInstanceOf(Error);
      expect((e as ManaParseError).name).toBe("ManaParseError");
    }
  });
});

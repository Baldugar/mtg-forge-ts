// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color } from "../color.js";
import { ManaCost } from "./cost.js";
import { ManaParseError, type ManaSymbol } from "./symbol.js";

describe("ManaCost.parse — basic symbols", () => {
  it("parses empty string as zero symbols", () => {
    const c = ManaCost.parse("");
    expect(c.symbols).toEqual([]);
  });

  it('parses "2WU" as generic 2, White, Blue', () => {
    const c = ManaCost.parse("2WU");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
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

  it('parses "0" as generic 0', () => {
    const c = ManaCost.parse("0");
    expect(c.symbols).toEqual<ManaSymbol[]>([{ kind: "generic", amount: 0 }]);
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

describe("ManaCost.parse — whitespace handling", () => {
  it("trims leading and trailing whitespace", () => {
    const c = ManaCost.parse("  2WU  ");
    expect(c.symbols).toEqual<ManaSymbol[]>([
      { kind: "generic", amount: 2 },
      { kind: "colored", color: Color.White },
      { kind: "colored", color: Color.Blue },
    ]);
  });

  it("rejects interior whitespace", () => {
    expect(() => ManaCost.parse("2 WU")).toThrow(ManaParseError);
    expect(() => ManaCost.parse("W U")).toThrow(ManaParseError);
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
    // 2/2 is not a valid monoHybrid (right must be a color)
    expect(() => ManaCost.parse("2/2")).toThrow(ManaParseError);
    // 3/W is not valid — monoHybrid left must be literal 2
    expect(() => ManaCost.parse("3/W")).toThrow(ManaParseError);
    // W/Q — Q is not a color or P
    expect(() => ManaCost.parse("W/Q")).toThrow(ManaParseError);
    // P/W — phyrexian form is "<Color>/P", not "P/<Color>"
    expect(() => ManaCost.parse("P/W")).toThrow(ManaParseError);
    // X/W — X is not valid on left of slash
    expect(() => ManaCost.parse("X/W")).toThrow(ManaParseError);
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

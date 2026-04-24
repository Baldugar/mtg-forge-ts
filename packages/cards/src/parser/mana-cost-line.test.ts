// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type LexedLine, lex } from "./lexer.js";
import { parseManaCostLine } from "./mana-cost-line.js";

const first = (source: string): LexedLine => {
  const lines = lex(source);
  if (lines[0] === undefined) throw new Error("no lines lexed");
  return lines[0];
};

describe("parseManaCostLine", () => {
  it("parses bare token 'R'", () => {
    const out = parseManaCostLine(first("ManaCost:R\n"));
    expect(out.raw).toBe("R");
    expect(out.symbols.length).toBeGreaterThanOrEqual(1);
  });
  it("parses generic + colored '3 W W'", () => {
    const out = parseManaCostLine(first("ManaCost:3 W W\n"));
    expect(out.raw).toBe("3 W W");
  });
  it("parses 'no cost' as empty symbols", () => {
    const out = parseManaCostLine(first("ManaCost:no cost\n"));
    expect(out.symbols).toEqual([]);
  });
  it("parses '0' as empty symbols", () => {
    const out = parseManaCostLine(first("ManaCost:0\n"));
    expect(out.symbols).toEqual([]);
  });
  it("rejects wrong prefix", () => {
    expect(() => parseManaCostLine(first("Name:Foo\n"))).toThrow(/expected prefix 'ManaCost'/);
  });
});

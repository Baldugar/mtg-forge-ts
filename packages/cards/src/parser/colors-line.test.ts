// SPDX-License-Identifier: GPL-3.0-or-later
import { Color } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { parseColorsLine } from "./colors-line.js";
import { type LexedLine, lex } from "./lexer.js";

const first = (source: string): LexedLine => {
  const lines = lex(source);
  if (lines[0] === undefined) throw new Error("no lines lexed");
  return lines[0];
};

describe("parseColorsLine", () => {
  it("parses single color 'red'", () => {
    const cs = parseColorsLine(first("Colors:red\n"));
    expect(cs.has(Color.Red)).toBe(true);
    expect(cs.has(Color.White)).toBe(false);
  });
  it("parses comma-separated 'white,blue'", () => {
    const cs = parseColorsLine(first("Colors:white,blue\n"));
    expect(cs.has(Color.White)).toBe(true);
    expect(cs.has(Color.Blue)).toBe(true);
    expect(cs.has(Color.Red)).toBe(false);
  });
  it("parses 'colorless' as all-false", () => {
    const cs = parseColorsLine(first("Colors:colorless\n"));
    expect(cs.has(Color.White)).toBe(false);
    expect(cs.has(Color.Blue)).toBe(false);
    expect(cs.has(Color.Black)).toBe(false);
    expect(cs.has(Color.Red)).toBe(false);
    expect(cs.has(Color.Green)).toBe(false);
  });
  it("rejects unknown color name", () => {
    expect(() => parseColorsLine(first("Colors:purple\n"))).toThrow();
  });
  it("rejects wrong prefix", () => {
    expect(() => parseColorsLine(first("Name:foo\n"))).toThrow(/expected prefix 'Colors'/);
  });
});

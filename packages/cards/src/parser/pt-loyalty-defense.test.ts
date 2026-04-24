// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type LexedLine, lex } from "./lexer.js";
import { parseDefenseLine, parseLoyaltyLine, parsePtLine } from "./pt-loyalty-defense.js";

const first = (source: string): LexedLine => {
  const lines = lex(source);
  if (lines[0] === undefined) throw new Error("no lines lexed");
  return lines[0];
};

describe("PT / Loyalty / Defense parsers", () => {
  it("parsePtLine splits '3/4'", () => {
    expect(parsePtLine(first("PT:3/4\n"))).toEqual({ power: "3", toughness: "4" });
  });
  it("parsePtLine preserves '*' and '1+*'", () => {
    expect(parsePtLine(first("PT:*/*\n"))).toEqual({ power: "*", toughness: "*" });
    expect(parsePtLine(first("PT:1+*/1+*\n"))).toEqual({ power: "1+*", toughness: "1+*" });
  });
  it("parsePtLine rejects non-slash input", () => {
    expect(() => parsePtLine(first("PT:not-a-pt\n"))).toThrow();
  });
  it("parseLoyaltyLine captures starting value", () => {
    expect(parseLoyaltyLine(first("Loyalty:4\n"))).toEqual({ starting: "4" });
  });
  it("parseDefenseLine captures starting value", () => {
    expect(parseDefenseLine(first("Defense:5\n"))).toEqual({ starting: "5" });
  });
});

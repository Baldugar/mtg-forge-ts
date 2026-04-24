// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type LexedLine, lex } from "./lexer.js";
import {
  parseAiHintLine,
  parseDeckHasLine,
  parseDeckHintsLine,
  parseDeckNeedsLine,
  parseNameLine,
  parseOracleLine,
  parseRulesLine,
  parseTextLine,
} from "./simple-lines.js";

const first = (source: string): LexedLine => {
  const lines = lex(source);
  if (lines[0] === undefined) throw new Error("no lines lexed");
  return lines[0];
};

describe("simple line parsers", () => {
  it("parseNameLine returns the raw name", () => {
    expect(parseNameLine(first("Name:Lightning Bolt\n"))).toBe("Lightning Bolt");
  });
  it("parseOracleLine preserves internal pipes via escape", () => {
    expect(parseOracleLine(first("Oracle:Foo\\|Bar\n"))).toBe("Foo|Bar");
  });
  it("parseTextLine / parseRulesLine mirror parseOracleLine", () => {
    expect(parseTextLine(first("Text:abc\n"))).toBe("abc");
    expect(parseRulesLine(first("Rules:xyz\n"))).toBe("xyz");
  });
  it("parseAiHintLine captures token map", () => {
    const out = parseAiHintLine(first("AI:RemoveDeck$All\n"));
    expect(out.get("RemoveDeck")).toBe("All");
  });
  it("parseDeckHas / Hints / Needs return token map", () => {
    expect(parseDeckHasLine(first("DeckHas:Ability$Graveyard\n")).get("Ability")).toBe("Graveyard");
    expect(parseDeckHintsLine(first("DeckHints:Type$Elf\n")).get("Type")).toBe("Elf");
    expect(parseDeckNeedsLine(first("DeckNeeds:Type$Land\n")).get("Type")).toBe("Land");
  });
  it("parseNameLine rejects wrong prefix", () => {
    expect(() => parseNameLine(first("Oracle:foo\n"))).toThrow(/expected prefix 'Name'/);
  });
});

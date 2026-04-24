// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type LexedLine, lex } from "./lexer.js";

describe("lex", () => {
  it("tokenizes a Name: line with no pipes", () => {
    const out = lex("Name:Lightning Bolt\n");
    expect(out).toEqual([
      { lineNumber: 1, prefix: "Name", content: "Lightning Bolt", tokens: [] },
    ] satisfies LexedLine[]);
  });

  it("tokenizes a single ability line with $-keyed params", () => {
    const out = lex("A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any\n");
    expect(out[0]?.prefix).toBe("A");
    expect(out[0]?.tokens).toEqual([
      new Map([["SP", "DealDamage"]]),
      new Map([["Cost", "R"]]),
      new Map([["NumDmg", "3"]]),
      new Map([["ValidTgts", "Any"]]),
    ]);
  });

  it("honors \\| escape inside values", () => {
    const out = lex("Text:foo\\|bar\n");
    expect(out[0]?.content).toBe("foo|bar");
  });

  it("honors \\$ escape inside values", () => {
    const out = lex("SVar:X:Count\\$PaidX\n");
    expect(out[0]?.content).toBe("X:Count$PaidX");
  });

  it("skips blank lines and # comment lines", () => {
    const out = lex("# comment\nName:Bolt\n\n");
    expect(out).toHaveLength(1);
    expect(out[0]?.prefix).toBe("Name");
  });

  it("preserves 1-indexed lineNumber across skipped lines", () => {
    const out = lex("# c1\nName:Bolt\n# c3\nManaCost:R\n");
    expect(out[0]?.lineNumber).toBe(2);
    expect(out[1]?.lineNumber).toBe(4);
  });

  it("trims whitespace around tokens but preserves inner whitespace", () => {
    const out = lex("A:SP$ DealDamage | ValidTgts$ Creature.YouCtrl\n");
    expect(out[0]?.tokens[0]).toEqual(new Map([["SP", "DealDamage"]]));
    expect(out[0]?.tokens[1]).toEqual(new Map([["ValidTgts", "Creature.YouCtrl"]]));
  });

  it("rejects lines without a prefix colon", () => {
    expect(() => lex("NoColonHere\n")).toThrow(/line 1: missing prefix colon/);
  });
});

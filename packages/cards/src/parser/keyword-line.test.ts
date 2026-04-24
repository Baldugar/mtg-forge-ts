// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseKeywordLine } from "./keyword-line.js";
import { lex } from "./lexer.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseKeywordLine", () => {
  it("parses simple 'K:Flying'", () => {
    const out = parseKeywordLine(first(lex("K:Flying\n")));
    expect(out.keyword).toBe("flying");
    expect(out.params).toBeUndefined();
  });

  it("parses 'K:First Strike' (display name with space)", () => {
    const out = parseKeywordLine(first(lex("K:First Strike\n")));
    expect(out.keyword).toBe("first_strike");
  });

  it("parses 'K:Kicker:2 R' with cost param", () => {
    const out = parseKeywordLine(first(lex("K:Kicker:2 R\n")));
    expect(out.keyword).toBe("kicker");
    expect(out.params?.cost).toEqual({ kind: "literal", raw: "2 R" });
  });

  it("parses 'K:Bushido:2' with amount param", () => {
    const out = parseKeywordLine(first(lex("K:Bushido:2\n")));
    expect(out.keyword).toBe("bushido");
    expect(out.params?.amount).toEqual({ kind: "literal", raw: "2" });
  });

  it("parses 'K:Jump-start' (hyphenated display)", () => {
    const out = parseKeywordLine(first(lex("K:Jump-start\n")));
    expect(out.keyword).toBe("jump_start");
  });

  it("rejects unknown keyword", () => {
    expect(() => parseKeywordLine(first(lex("K:Notakeyword\n")))).toThrow(/unknown keyword/);
  });
});

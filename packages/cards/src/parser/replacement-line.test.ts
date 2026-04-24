// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { parseReplacementLine } from "./replacement-line.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseReplacementLine", () => {
  it("parses Moved replacement with ReplaceWith", () => {
    const out = parseReplacementLine(
      first(
        lex(
          "R:Event$ Moved | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | ReplaceWith$ DBExile | Description$ If this would die, exile it instead.\n",
        ),
      ),
    );
    expect(out.eventKind).toBe("Moved");
    expect(out.params.Origin).toEqual({ kind: "literal", raw: "Any" });
    expect(out.effect.handlerKey).toBe("DBExile");
    expect(out.isSelf).toBeUndefined();
  });

  it("rejects replacements without Event$", () => {
    expect(() => parseReplacementLine(first(lex("R:ReplaceWith$ DBX\n")))).toThrow(/missing Event/);
  });

  it("rejects unknown Event$ type", () => {
    expect(() => parseReplacementLine(first(lex("R:Event$ NotARealType | ReplaceWith$ DBX\n")))).toThrow(
      /unknown Event/,
    );
  });

  it("flags self-replacement via Self$ True", () => {
    const out = parseReplacementLine(first(lex("R:Event$ Moved | Self$ True | ReplaceWith$ DBExile\n")));
    expect(out.isSelf).toBe(true);
  });

  it("normalizes Event$ case ('moved' -> 'Moved')", () => {
    const out = parseReplacementLine(first(lex("R:Event$ moved | ReplaceWith$ DBX\n")));
    expect(out.eventKind).toBe("Moved");
  });
});

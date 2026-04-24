// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { parseSVarLine } from "./svar-line.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseSVarLine", () => {
  it("parses a value SVar 'X:Count$xPaid'", () => {
    const out = parseSVarLine(first(lex("SVar:X:Count$xPaid\n")));
    expect(out.name).toBe("X");
    expect(out.ast.kind).toBe("value");
    expect(out.ast.expression?.kind).toBe("Count");
    expect(out.ast.expression?.raw).toBe("Count$xPaid");
  });

  it("parses an ability SVar 'TrigDraw:DB$ Draw | NumCards$ 1'", () => {
    const out = parseSVarLine(first(lex("SVar:TrigDraw:DB$ Draw | NumCards$ 1\n")));
    expect(out.name).toBe("TrigDraw");
    expect(out.ast.kind).toBe("ability");
    expect(out.ast.ability?.handlerKey).toBe("Draw");
    expect(out.ast.ability?.params.NumCards).toEqual({ kind: "literal", raw: "1" });
  });

  it("parses a plain-number value SVar 'N:5'", () => {
    const out = parseSVarLine(first(lex("SVar:N:5\n")));
    expect(out.name).toBe("N");
    expect(out.ast.kind).toBe("value");
    expect(out.ast.raw).toBe("5");
  });

  it("rejects lines without colon separator", () => {
    expect(() => parseSVarLine(first(lex("SVar:just-a-name\n")))).toThrow(/missing ':' separator/);
  });
});

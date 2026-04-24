import type { SVarAst } from "@mtg-forge-ts/core";
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../game.js";
import type { SvarContext } from "./context.js";
import { evaluateSVar } from "./evaluator.js";
import { selectorRegistry } from "./selector-registry.js";

const mkCtx = (overrides: Partial<SvarContext> = {}): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map<string, SVarAst>(),
  ...overrides,
});

describe("evaluateSVar dispatcher", () => {
  it("evaluates literal integer to number", () => {
    expect(evaluateSVar({ kind: "literal", raw: "5" }, mkCtx())).toBe(5);
  });

  it("throws on non-numeric literal", () => {
    expect(() => evaluateSVar({ kind: "literal", raw: "Any" }, mkCtx())).toThrow(/not a number/);
  });

  it("resolves svarRef by name and recursively evaluates", () => {
    // Register a temporary selector for this test
    selectorRegistry.register("TestNumber", (ast) => Number(ast.args?.[0]?.raw ?? "0"));
    const svars = new Map<string, SVarAst>([
      [
        "X",
        {
          kind: "value",
          raw: "TestNumber$7",
          expression: { kind: "TestNumber", raw: "TestNumber$7", args: [{ kind: "literal", raw: "7" }] },
        },
      ],
    ]);
    expect(evaluateSVar({ kind: "svarRef", name: "X" }, mkCtx({ svars }))).toBe(7);
  });

  it("throws on unknown expression kind", () => {
    expect(() =>
      evaluateSVar({ kind: "expression", ast: { kind: "NotAKind", raw: "NotAKind$foo" } }, mkCtx()),
    ).toThrow(/unknown SVar selector/);
  });

  it("returns ability EffectInvocation for ability-form svarRef", () => {
    const svars = new Map<string, SVarAst>([
      [
        "TrigDraw",
        {
          kind: "ability",
          raw: "DB$ Draw",
          ability: { handlerKey: "Draw", params: {} },
        },
      ],
    ]);
    const result = evaluateSVar({ kind: "svarRef", name: "TrigDraw" }, mkCtx({ svars }));
    expect(typeof result).toBe("object");
    expect((result as { handlerKey: string }).handlerKey).toBe("Draw");
  });
});

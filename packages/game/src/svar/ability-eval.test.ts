import type { SVarAst } from "@mtg-forge-ts/core";
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../game.js";
import { evaluateSVarAsAbility } from "./ability-eval.js";
import type { SvarContext } from "./context.js";

const mkCtx = (svars: Map<string, SVarAst>): SvarContext => ({
  game: {} as unknown as Game,
  svars,
});

describe("evaluateSVarAsAbility", () => {
  it("returns EffectInvocation for ability-form SVar", () => {
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
    const result = evaluateSVarAsAbility("TrigDraw", mkCtx(svars));
    expect(result.handlerKey).toBe("Draw");
  });

  it("throws when SVar is value-form, not ability", () => {
    const svars = new Map<string, SVarAst>([["X", { kind: "value", raw: "Count$xPaid" }]]);
    expect(() => evaluateSVarAsAbility("X", mkCtx(svars))).toThrow(/value-form, not ability/);
  });

  it("throws when SVar is unknown", () => {
    const svars = new Map<string, SVarAst>();
    expect(() => evaluateSVarAsAbility("Missing", mkCtx(svars))).toThrow(/unknown SVar/);
  });
});

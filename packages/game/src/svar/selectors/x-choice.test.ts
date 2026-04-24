// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./x-choice.js";

const mkCtx = (xValue?: number): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map(),
  ...(xValue !== undefined ? { xValue } : {}),
});

describe("X and XChoice selectors", () => {
  it("X returns ctx.xValue when set", () => {
    expect(evaluateExpression({ kind: "X", raw: "X$" }, mkCtx(5))).toBe(5);
  });

  it("X returns 0 when xValue is undefined", () => {
    expect(evaluateExpression({ kind: "X", raw: "X$" }, mkCtx())).toBe(0);
  });

  it("XChoice returns ctx.xValue when set", () => {
    expect(evaluateExpression({ kind: "XChoice", raw: "XChoice$" }, mkCtx(7))).toBe(7);
  });

  it("XChoice returns 0 when xValue is undefined", () => {
    expect(evaluateExpression({ kind: "XChoice", raw: "XChoice$" }, mkCtx())).toBe(0);
  });
});

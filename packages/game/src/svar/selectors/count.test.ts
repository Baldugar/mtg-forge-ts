// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./count.js";

const mkCtx = (xValue?: number): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map(),
  xValue,
});

describe("Count$ selector", () => {
  it("returns xValue for xPaid arg", () => {
    expect(
      evaluateExpression(
        { kind: "Count", raw: "Count$xPaid", args: [{ kind: "literal", raw: "xPaid" }] },
        mkCtx(4),
      ),
    ).toBe(4);
  });

  it("returns literal integer when arg is a number", () => {
    expect(
      evaluateExpression({ kind: "Count", raw: "Count$3", args: [{ kind: "literal", raw: "3" }] }, mkCtx()),
    ).toBe(3);
  });

  it("throws on unsupported arg", () => {
    expect(() =>
      evaluateExpression(
        {
          kind: "Count",
          raw: "Count$Valid.Creature.YouCtrl",
          args: [{ kind: "literal", raw: "Valid.Creature.YouCtrl" }],
        },
        mkCtx(),
      ),
    ).toThrow(/unsupported arg/);
  });
});

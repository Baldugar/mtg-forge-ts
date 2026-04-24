// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./number.js";

const mkCtx = (): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map(),
});

describe("Number$ selector", () => {
  it("evaluates integer arg to number", () => {
    expect(
      evaluateExpression({ kind: "Number", raw: "Number$5", args: [{ kind: "literal", raw: "5" }] }, mkCtx()),
    ).toBe(5);
  });

  it("evaluates zero", () => {
    expect(
      evaluateExpression({ kind: "Number", raw: "Number$0", args: [{ kind: "literal", raw: "0" }] }, mkCtx()),
    ).toBe(0);
  });

  it("throws on non-numeric arg", () => {
    expect(() =>
      evaluateExpression(
        { kind: "Number", raw: "Number$Any", args: [{ kind: "literal", raw: "Any" }] },
        mkCtx(),
      ),
    ).toThrow(/not a number/);
  });
});

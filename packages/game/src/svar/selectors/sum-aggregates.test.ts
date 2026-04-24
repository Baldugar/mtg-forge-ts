// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./sum-aggregates.js";

const mkCtx = (): SvarContext => ({
  game: {} as unknown as Game,
  svars: new Map(),
});

describe("SumPower / SumToughness / SumCMC selector stubs", () => {
  it("SumPower throws deferred error", () => {
    expect(() =>
      evaluateExpression({ kind: "SumPower", raw: "SumPower$Valid.Creature.YouCtrl" }, mkCtx()),
    ).toThrow(/deferred to SP3 Part C/);
  });

  it("SumToughness throws deferred error", () => {
    expect(() =>
      evaluateExpression({ kind: "SumToughness", raw: "SumToughness$Valid.Creature.YouCtrl" }, mkCtx()),
    ).toThrow(/deferred to SP3 Part C/);
  });

  it("SumCMC throws deferred error", () => {
    expect(() =>
      evaluateExpression({ kind: "SumCMC", raw: "SumCMC$Valid.Creature.YouCtrl" }, mkCtx()),
    ).toThrow(/deferred to SP3 Part C/);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import type { DecisionRequest } from "@mtg-forge-ts/core";
import { IllegalDecisionError, SeededRng, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { RandomLegalController } from "./random-legal-controller.js";

describe("RandomLegalController", () => {
  it("answers priority with pass", () => {
    const c = new RandomLegalController(new SeededRng(1n));
    const req: DecisionRequest = {
      kind: "priority",
      playerSeat: mkPlayerSeat(0),
      legalActions: [{ kind: "pass" }],
    };
    expect(c.decide(req)).toEqual({ kind: "priority", action: { kind: "pass" } });
  });

  it("answers mulligan with keep", () => {
    const c = new RandomLegalController(new SeededRng(1n));
    const req: DecisionRequest = {
      kind: "mulligan",
      playerSeat: mkPlayerSeat(0),
      currentHand: [mkEntityId(1), mkEntityId(2)],
      mulligansSoFar: 0,
      rule: "london",
    };
    expect(c.decide(req)).toEqual({ kind: "mulligan", keep: true });
  });

  it("throws IllegalDecisionError on an unsupported SP1 kind", () => {
    const c = new RandomLegalController(new SeededRng(1n));
    const req: DecisionRequest = {
      kind: "chooseTargets",
      sourceId: mkEntityId(1),
      restriction: null,
      min: 1,
      max: 1,
      choicesAllowed: [mkEntityId(2)],
    };
    expect(() => c.decide(req)).toThrow(IllegalDecisionError);
  });

  it("IllegalDecisionError message calls out SP2 coverage expansion", () => {
    const c = new RandomLegalController(new SeededRng(42n));
    const req: DecisionRequest = {
      kind: "chooseX",
      sourceId: mkEntityId(1),
      maxX: 4,
    };
    try {
      c.decide(req);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalDecisionError);
      expect((e as Error).message).toContain("chooseX");
      expect((e as Error).message).toContain("SP2");
    }
  });

  it("multiple unsupported kinds all throw", () => {
    const c = new RandomLegalController(new SeededRng(1n));
    const kinds = [
      { kind: "chooseModes", sourceId: mkEntityId(1), modes: [], min: 0, max: 0 },
      { kind: "declareAttackers", playerSeat: mkPlayerSeat(0), legalAttackers: [], legalDefenders: [] },
      { kind: "declareBlockers", playerSeat: mkPlayerSeat(1), legalBlockers: [], attackers: [] },
      { kind: "scry", playerSeat: mkPlayerSeat(0), cards: [] },
    ] as const;
    for (const k of kinds) {
      expect(() => c.decide(k as DecisionRequest)).toThrow(IllegalDecisionError);
    }
  });
});

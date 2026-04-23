// SPDX-License-Identifier: GPL-3.0-or-later
import type { DecisionRequest, DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { HumanController } from "./human-controller.js";

describe("HumanController", () => {
  it("delegates decide() to the supplied callback and returns its response", () => {
    let seen: DecisionRequest | null = null;
    const controller = new HumanController((req) => {
      seen = req;
      return { kind: "mulligan", keep: true };
    });
    const req: DecisionRequest = {
      kind: "mulligan",
      playerSeat: mkPlayerSeat(0),
      currentHand: [] as readonly EntityId[],
      mulligansSoFar: 0,
      rule: "london",
    };
    const res: DecisionResponse = controller.decide(req);
    expect(seen).toBe(req);
    expect(res).toEqual({ kind: "mulligan", keep: true });
  });

  it("passes through every DecisionRequest unmodified", () => {
    // Sanity: the controller should be a transparent wrapper; no filtering or
    // request mutation occurs. Multiple sequential calls are supported.
    const responses: DecisionResponse[] = [
      { kind: "mulligan", keep: false },
      { kind: "priority", action: { kind: "pass" } },
    ];
    let i = 0;
    const controller = new HumanController(() => {
      const r = responses[i++];
      if (!r) throw new Error("ran out of responses");
      return r;
    });
    const req1: DecisionRequest = {
      kind: "mulligan",
      playerSeat: mkPlayerSeat(0),
      currentHand: [],
      mulligansSoFar: 0,
      rule: "london",
    };
    expect(controller.decide(req1).kind).toBe("mulligan");
    const req2: DecisionRequest = {
      kind: "priority",
      playerSeat: mkPlayerSeat(0),
      legalActions: [{ kind: "pass" }],
    };
    expect(controller.decide(req2).kind).toBe("priority");
  });

  it("consumer-side async UI pattern: the wrapper stays sync; suspension lives in the generator", () => {
    // This test documents the intended async-UI integration pattern:
    // the consumer runs the engine generator in their own loop and awaits
    // their UI between `gen.next()` calls. HumanController receives the
    // resolved value synchronously at dispatch time. Here we simulate the
    // resolved-value stage with a precomputed responses map — the engine
    // never observes a Promise.
    const resolved = new Map<DecisionRequest["kind"], DecisionResponse>([
      ["mulligan", { kind: "mulligan", keep: true }],
    ]);
    const controller = new HumanController((req) => {
      const r = resolved.get(req.kind);
      if (!r) throw new Error(`no resolved response for ${req.kind}`);
      return r;
    });
    const req: DecisionRequest = {
      kind: "mulligan",
      playerSeat: mkPlayerSeat(0),
      currentHand: [],
      mulligansSoFar: 0,
      rule: "london",
    };
    const res = controller.decide(req);
    expect(res.kind).toBe("mulligan");
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import type { DecisionRequest, DecisionResponse } from "@mtg-forge-ts/core";
import { DecisionLogCorruptError, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { ScriptedController } from "./scripted-controller.js";

const mulliganReq = (seat = 0, mulligansSoFar = 0): DecisionRequest => ({
  kind: "mulligan",
  playerSeat: mkPlayerSeat(seat),
  currentHand: [],
  mulligansSoFar,
  rule: "london",
});

const priorityReq = (seat = 0): DecisionRequest => ({
  kind: "priority",
  playerSeat: mkPlayerSeat(seat),
  legalActions: [{ kind: "pass" }],
});

describe("ScriptedController", () => {
  it("consumes scripted responses in order", () => {
    const script: DecisionResponse[] = [
      { kind: "mulligan", keep: true },
      { kind: "mulligan", keep: false },
      { kind: "priority", action: { kind: "pass" } },
    ];
    const c = new ScriptedController(script);
    expect(c.remaining()).toBe(3);
    expect(c.decide(mulliganReq())).toEqual({ kind: "mulligan", keep: true });
    expect(c.decide(mulliganReq(0, 1))).toEqual({ kind: "mulligan", keep: false });
    expect(c.decide(priorityReq())).toEqual({ kind: "priority", action: { kind: "pass" } });
    expect(c.hasMore()).toBe(false);
    expect(c.remaining()).toBe(0);
  });

  it("throws DecisionLogCorruptError when out of responses", () => {
    const c = new ScriptedController([{ kind: "mulligan", keep: true }]);
    c.decide(mulliganReq());
    expect(() => c.decide(mulliganReq())).toThrow(DecisionLogCorruptError);
  });

  it("throws DecisionLogCorruptError on kind mismatch", () => {
    // WHY: replay drift is nearly always a kind mismatch; the message must
    // surface both expected and actual discriminators for debuggability.
    const c = new ScriptedController([{ kind: "priority", action: { kind: "pass" } }]);
    expect(() => c.decide(mulliganReq())).toThrow(DecisionLogCorruptError);
  });

  it("mismatch error identifies the offending index", () => {
    const script: DecisionResponse[] = [
      { kind: "mulligan", keep: true },
      { kind: "priority", action: { kind: "pass" } },
    ];
    const c = new ScriptedController(script);
    c.decide(mulliganReq());
    try {
      c.decide(mulliganReq(0, 1));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DecisionLogCorruptError);
      expect((e as Error).message).toContain("index 1");
      expect((e as Error).message).toContain("expected mulligan");
      expect((e as Error).message).toContain("got priority");
    }
  });

  it("hasMore and remaining track cursor position", () => {
    const c = new ScriptedController([
      { kind: "mulligan", keep: true },
      { kind: "mulligan", keep: true },
    ]);
    expect(c.hasMore()).toBe(true);
    expect(c.remaining()).toBe(2);
    c.decide(mulliganReq());
    expect(c.remaining()).toBe(1);
    c.decide(mulliganReq());
    expect(c.hasMore()).toBe(false);
  });

  it("empty script throws on first call", () => {
    const c = new ScriptedController([]);
    // WHY: the error message must include the request kind so a stale log
    // points developers at the first request it couldn't answer.
    void mkEntityId;
    expect(() => c.decide(mulliganReq())).toThrow(/mulligan/);
  });
});

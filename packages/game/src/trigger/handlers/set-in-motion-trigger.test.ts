// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — SetInMotionTrigger tests. Verifies match-on
// SchemeSetInMotion with ValidCard$ Card / Card.Self filtering and
// rejection of unrelated event kinds.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { SetInMotionTrigger } from "./set-in-motion-trigger.js";

const SOURCE_ID = mkEntityId(60);
const OTHER_SCHEME_ID = mkEntityId(61);
const TRIGGER_ID = mkEntityId(6);
const ARCHENEMY = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: ARCHENEMY,
  triggerId: TRIGGER_ID,
});

const mkAst = (validCard: string): TriggerAst => ({
  mode: "SetInMotion",
  params: { ValidCard: { kind: "literal", raw: validCard } },
  effect: { handlerKey: "GoodTimes", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(SetInMotionTrigger);
});

triggerHandlerRegistry.register(SetInMotionTrigger);

describe("SetInMotionTrigger (Batch D2)", () => {
  it("is registered under mode 'SetInMotion'", () => {
    expect(triggerHandlerRegistry.has("SetInMotion")).toBe(true);
  });

  it("matches SchemeSetInMotion with ValidCard$ Card.Self when scheme is the source", () => {
    const Cls = triggerHandlerRegistry.lookup("SetInMotion");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const event = mkEvent("SchemeSetInMotion", 1, PhaseStep.Upkeep, {
      schemeCardId: SOURCE_ID,
      archenemySeat: ARCHENEMY,
    });
    expect(ta.matches(event)).toBe(true);
  });

  it("does NOT match SchemeSetInMotion with ValidCard$ Card.Self when a DIFFERENT scheme is set in motion", () => {
    const Cls = triggerHandlerRegistry.lookup("SetInMotion");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const event = mkEvent("SchemeSetInMotion", 1, PhaseStep.Upkeep, {
      schemeCardId: OTHER_SCHEME_ID,
      archenemySeat: ARCHENEMY,
    });
    expect(ta.matches(event)).toBe(false);
  });

  it("matches with ValidCard$ Card for any scheme", () => {
    const Cls = triggerHandlerRegistry.lookup("SetInMotion");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card"), mkCtx());
    const event = mkEvent("SchemeSetInMotion", 1, PhaseStep.Upkeep, {
      schemeCardId: OTHER_SCHEME_ID,
      archenemySeat: ARCHENEMY,
    });
    expect(ta.matches(event)).toBe(true);
  });

  it("does NOT match unrelated events", () => {
    const Cls = triggerHandlerRegistry.lookup("SetInMotion");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const event = mkEvent("PlanarDieRolled", 1, PhaseStep.Upkeep, {
      rollingSeat: ARCHENEMY,
      result: "chaos",
    });
    expect(ta.matches(event)).toBe(false);
  });
});

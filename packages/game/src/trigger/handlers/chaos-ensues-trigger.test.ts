// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — ChaosEnsuesTrigger tests. Verifies match-on PlanarDieRolled
// with face === "chaos", correct rejection of "planeswalk"/"blank" results
// and unrelated event kinds.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { ChaosEnsuesTrigger } from "./chaos-ensues-trigger.js";

const SOURCE_ID = mkEntityId(50);
const TRIGGER_ID = mkEntityId(5);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (): TriggerAst => ({
  mode: "ChaosEnsues",
  params: {},
  effect: { handlerKey: "TrigDiscard", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(ChaosEnsuesTrigger);
});

triggerHandlerRegistry.register(ChaosEnsuesTrigger);

describe("ChaosEnsuesTrigger (Batch D2)", () => {
  it("is registered under mode 'ChaosEnsues'", () => {
    expect(triggerHandlerRegistry.has("ChaosEnsues")).toBe(true);
  });

  it("matches PlanarDieRolled with result === 'chaos'", () => {
    const Cls = triggerHandlerRegistry.lookup("ChaosEnsues");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("PlanarDieRolled", 1, PhaseStep.Main1, {
      rollingSeat: CONTROLLER,
      result: "chaos",
    });
    expect(ta.matches(event)).toBe(true);
  });

  it("does NOT match PlanarDieRolled with result === 'planeswalk'", () => {
    const Cls = triggerHandlerRegistry.lookup("ChaosEnsues");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("PlanarDieRolled", 1, PhaseStep.Main1, {
      rollingSeat: OPPONENT,
      result: "planeswalk",
    });
    expect(ta.matches(event)).toBe(false);
  });

  it("does NOT match PlanarDieRolled with result === 'blank'", () => {
    const Cls = triggerHandlerRegistry.lookup("ChaosEnsues");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("PlanarDieRolled", 1, PhaseStep.Main1, {
      rollingSeat: CONTROLLER,
      result: "blank",
    });
    expect(ta.matches(event)).toBe(false);
  });

  it("matches regardless of which seat rolled (chaos affects active plane)", () => {
    const Cls = triggerHandlerRegistry.lookup("ChaosEnsues");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("PlanarDieRolled", 1, PhaseStep.Main1, {
      rollingSeat: OPPONENT,
      result: "chaos",
    });
    expect(ta.matches(event)).toBe(true);
  });

  it("does NOT match unrelated events", () => {
    const Cls = triggerHandlerRegistry.lookup("ChaosEnsues");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("SpellCast", 1, PhaseStep.Main1, {
      stackItemId: mkEntityId(99),
      cardId: mkEntityId(100),
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(event)).toBe(false);
  });
});

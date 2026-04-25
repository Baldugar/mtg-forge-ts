// SPDX-License-Identifier: GPL-3.0-or-later
// Task 3 — PhaseTrigger tests.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Import for side-effect to register PhaseTrigger at module load time.
import { PhaseTrigger } from "./phase-trigger.js";

const SOURCE_ID = mkEntityId(20);
const TRIGGER_ID = mkEntityId(2);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkUpkeepAst = (): TriggerAst => ({
  mode: "Phase",
  params: {
    Phase: { kind: "literal", raw: "Upkeep" },
    ValidPlayer: { kind: "literal", raw: "You" },
  },
  effect: { handlerKey: "TrigScry", params: {} },
});

const mkStepStartedEvent = (step: PhaseStep, activeSeat: ReturnType<typeof mkPlayerSeat>) =>
  mkEvent("StepStarted", 1, step, { step, activeSeat });

// Re-register after each clear
afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(PhaseTrigger);
});

// Register before all tests in this file
triggerHandlerRegistry.register(PhaseTrigger);

describe("PhaseTrigger", () => {
  it("is registered under mode 'Phase'", () => {
    expect(triggerHandlerRegistry.has("Phase")).toBe(true);
  });

  describe("Upkeep trigger (ValidPlayer$ You)", () => {
    it("matches when controller's upkeep begins", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const event = mkStepStartedEvent(PhaseStep.Upkeep, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match on opponent's upkeep (ValidPlayer$ You)", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const event = mkStepStartedEvent(PhaseStep.Upkeep, OPPONENT);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match a different step (BeginCombat)", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const event = mkStepStartedEvent(PhaseStep.BeginCombat, CONTROLLER);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match a non-StepStarted event", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const lifeEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
        playerSeat: CONTROLLER,
        oldLife: 20,
        newLife: 18,
        delta: -2,
        cause: "effect",
      });
      expect(ta.matches(lifeEvent)).toBe(false);
    });
  });

  describe("EndOfTurn alias", () => {
    it("matches EndStep when Phase$ is 'EndOfTurn'", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const eotAst: TriggerAst = {
        mode: "Phase",
        params: {
          Phase: { kind: "literal", raw: "EndOfTurn" },
          ValidPlayer: { kind: "literal", raw: "Each" },
        },
        effect: { handlerKey: "TrigEOT", params: {} },
      };
      const ta = new Cls().build(eotAst, mkCtx());

      const event = mkStepStartedEvent(PhaseStep.EndStep, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });
  });

  describe("ValidPlayer$ Opponent", () => {
    it("fires on opponent's upkeep, not controller's", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ast: TriggerAst = {
        mode: "Phase",
        params: {
          Phase: { kind: "literal", raw: "Upkeep" },
          ValidPlayer: { kind: "literal", raw: "Opponent" },
        },
        effect: { handlerKey: "TrigOpp", params: {} },
      };
      const ta = new Cls().build(ast, mkCtx());

      expect(ta.matches(mkStepStartedEvent(PhaseStep.Upkeep, OPPONENT))).toBe(true);
      expect(ta.matches(mkStepStartedEvent(PhaseStep.Upkeep, CONTROLLER))).toBe(false);
    });
  });

  describe("ValidPlayer$ Each", () => {
    it("fires on any player's draw step", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ast: TriggerAst = {
        mode: "Phase",
        params: {
          Phase: { kind: "literal", raw: "Draw" },
          ValidPlayer: { kind: "literal", raw: "Each" },
        },
        effect: { handlerKey: "TrigEach", params: {} },
      };
      const ta = new Cls().build(ast, mkCtx());

      expect(ta.matches(mkStepStartedEvent(PhaseStep.Draw, CONTROLLER))).toBe(true);
      expect(ta.matches(mkStepStartedEvent(PhaseStep.Draw, OPPONENT))).toBe(true);
    });
  });

  describe("TriggeredAbility identity fields", () => {
    it("has correct id, sourceCardId, kind, isDelayed", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
      expect(ta.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    });
  });
});

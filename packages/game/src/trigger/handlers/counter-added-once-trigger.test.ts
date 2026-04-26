// SPDX-License-Identifier: GPL-3.0-or-later
// CounterAddedOnceTrigger tests — Wave 12B once-per-turn fire guard.
//
// Verifies registration, CounterAdded event matching, ValidCard$ /
// CounterType$ filters, and the once-per-turn semantic gate that
// suppresses re-fires until `game.turn` advances.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { CounterAddedOnceTrigger } from "./counter-added-once-trigger.js";

const SOURCE_ID = mkEntityId(70);
const OTHER_ID = mkEntityId(71);
const TRIGGER_ID = mkEntityId(9);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkTurnedCtx = (turnRef: { value: number }): TriggerBuildContext =>
  ({
    game: {
      get turn() {
        return turnRef.value;
      },
    } as unknown,
    sourceCardId: SOURCE_ID,
    controllerSeat: CONTROLLER,
    triggerId: TRIGGER_ID,
  }) as TriggerBuildContext;

const mkAst = (validCard = "Card.Self", counterType?: string): TriggerAst => ({
  mode: "CounterAddedOnce",
  params: {
    ValidCard: { kind: "literal", raw: validCard },
    ...(counterType !== undefined ? { CounterType: { kind: "literal" as const, raw: counterType } } : {}),
  },
  effect: { handlerKey: "TrigEffect", params: {} },
});

const mkCounterAddedEvent = (cardId = SOURCE_ID, counterType = "P1P1") =>
  mkEvent("CounterAdded", 1, PhaseStep.Main1, {
    cardId,
    counterType,
    amount: 1,
  });

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(CounterAddedOnceTrigger);
});
triggerHandlerRegistry.register(CounterAddedOnceTrigger);

describe("CounterAddedOnceTrigger", () => {
  it("is registered under mode 'CounterAddedOnce'", () => {
    expect(triggerHandlerRegistry.has("CounterAddedOnce")).toBe(true);
  });

  it("matches a CounterAdded event on Card.Self", () => {
    const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
    if (!Cls) throw new Error("registry missing");
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(ta.matches(mkCounterAddedEvent())).toBe(true);
  });

  it("does NOT match a CounterAdded event on a different card (Card.Self filter)", () => {
    const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
    if (!Cls) throw new Error("registry missing");
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(ta.matches(mkCounterAddedEvent(OTHER_ID))).toBe(false);
  });

  it("respects ValidCard$ Card (any card)", () => {
    const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
    if (!Cls) throw new Error("registry missing");
    const ta = new Cls().build(mkAst("Card"), mkCtx());
    expect(ta.matches(mkCounterAddedEvent(OTHER_ID))).toBe(true);
  });

  it("respects optional CounterType$ filter", () => {
    const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
    if (!Cls) throw new Error("registry missing");
    const ta = new Cls().build(mkAst("Card.Self", "P1P1"), mkCtx());
    expect(ta.matches(mkCounterAddedEvent(SOURCE_ID, "P1P1"))).toBe(true);
    expect(ta.matches(mkCounterAddedEvent(SOURCE_ID, "CHARGE"))).toBe(false);
  });

  it("does NOT match a non-CounterAdded event", () => {
    const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
    if (!Cls) throw new Error("registry missing");
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(false);
  });

  // ─── Wave 12B once-per-turn guard ────────────────────────────────────────
  describe("once-per-turn guard", () => {
    it("first match in a turn → true", () => {
      const turnRef = { value: 1 };
      const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
      if (!Cls) throw new Error("registry missing");
      const ta = new Cls().build(mkAst(), mkTurnedCtx(turnRef));
      expect(ta.matches(mkCounterAddedEvent())).toBe(true);
    });

    it("second match in the same turn → false (suppressed)", () => {
      const turnRef = { value: 5 };
      const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
      if (!Cls) throw new Error("registry missing");
      const ta = new Cls().build(mkAst(), mkTurnedCtx(turnRef));
      expect(ta.matches(mkCounterAddedEvent())).toBe(true);
      expect(ta.matches(mkCounterAddedEvent())).toBe(false);
    });

    it("turn advances → guard resets", () => {
      const turnRef = { value: 3 };
      const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
      if (!Cls) throw new Error("registry missing");
      const ta = new Cls().build(mkAst(), mkTurnedCtx(turnRef));
      expect(ta.matches(mkCounterAddedEvent())).toBe(true);
      expect(ta.matches(mkCounterAddedEvent())).toBe(false);
      turnRef.value = 4;
      expect(ta.matches(mkCounterAddedEvent())).toBe(true);
      turnRef.value = 5;
      expect(ta.matches(mkCounterAddedEvent())).toBe(true);
    });

    it("non-matching event does not consume the slot", () => {
      const turnRef = { value: 1 };
      const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
      if (!Cls) throw new Error("registry missing");
      const ta = new Cls().build(mkAst("Card.Self", "P1P1"), mkTurnedCtx(turnRef));
      // Wrong counter type — predicate fails, slot stays open.
      expect(ta.matches(mkCounterAddedEvent(SOURCE_ID, "CHARGE"))).toBe(false);
      // Real match — should fire.
      expect(ta.matches(mkCounterAddedEvent(SOURCE_ID, "P1P1"))).toBe(true);
      // Slot consumed now.
      expect(ta.matches(mkCounterAddedEvent(SOURCE_ID, "P1P1"))).toBe(false);
    });
  });

  it("has correct identity fields", () => {
    const Cls = triggerHandlerRegistry.lookup("CounterAddedOnce");
    if (!Cls) throw new Error("registry missing");
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
    expect(ta.isDelayed).toBe(false);
  });
});

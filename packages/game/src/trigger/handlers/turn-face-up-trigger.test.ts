// SPDX-License-Identifier: GPL-3.0-or-later
// TurnFaceUpTrigger tests — "when this is turned face up" trigger.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TurnFaceUpTrigger } from "./turn-face-up-trigger.js";

const SOURCE_ID = mkEntityId(30);
const OTHER_ID = mkEntityId(40);
const TRIGGER_ID = mkEntityId(3);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

/** CardTurnedFaceUp event for a specific card. */
const mkTurnedFaceUpEvent = (cardId: ReturnType<typeof mkEntityId>) =>
  mkEvent("CardTurnedFaceUp", 1, PhaseStep.Main1, {
    cardId,
    previousKind: "morph" as const,
  });

const mkAst = (validCard?: string): TriggerAst => ({
  mode: "TurnFaceUp",
  params: {
    ...(validCard !== undefined ? { ValidCard: { kind: "literal" as const, raw: validCard } } : {}),
  },
  effect: { handlerKey: "TrigEffect", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(TurnFaceUpTrigger);
});

triggerHandlerRegistry.register(TurnFaceUpTrigger);

describe("TurnFaceUpTrigger", () => {
  it("is registered under mode 'TurnFaceUp'", () => {
    expect(triggerHandlerRegistry.has("TurnFaceUp")).toBe(true);
  });

  describe("ValidCard$ Card.Self (default)", () => {
    it("matches when the source card is turned face up", () => {
      const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
      expect(ta.matches(mkTurnedFaceUpEvent(SOURCE_ID))).toBe(true);
    });

    it("does NOT match when a DIFFERENT card is turned face up", () => {
      const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
      expect(ta.matches(mkTurnedFaceUpEvent(OTHER_ID))).toBe(false);
    });

    it("defaults to Card.Self when ValidCard$ absent", () => {
      const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst(), mkCtx());
      expect(ta.matches(mkTurnedFaceUpEvent(SOURCE_ID))).toBe(true);
      expect(ta.matches(mkTurnedFaceUpEvent(OTHER_ID))).toBe(false);
    });
  });

  describe("ValidCard$ Card (any card turned face up)", () => {
    it("matches when any card is turned face up", () => {
      const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card"), mkCtx());
      expect(ta.matches(mkTurnedFaceUpEvent(OTHER_ID))).toBe(true);
    });
  });

  it("does NOT match a non-CardTurnedFaceUp event", () => {
    const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const wrongEvent = mkEvent("BlockersDeclared", 1, PhaseStep.DeclareBlockers, {
      defendingSeat: CONTROLLER,
      blocks: [],
    });
    expect(ta.matches(wrongEvent)).toBe(false);
  });

  it("has correct identity fields", () => {
    const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
    expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
    expect(ta.isDelayed).toBe(false);
  });

  it("has a non-null resolver", () => {
    const Cls = triggerHandlerRegistry.lookup("TurnFaceUp");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const resolver = (ta as unknown as { resolver?: unknown }).resolver;
    expect(resolver).not.toBeNull();
    expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// TransformedTrigger tests — Wave 9.
// Verifies registration and Transformed event matching.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TransformedTrigger } from "./transformed-trigger.js";

const SOURCE_ID = mkEntityId(90);
const OTHER_ID = mkEntityId(91);
const TRIGGER_ID = mkEntityId(11);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (validCard = "Card.Self"): TriggerAst => ({
  mode: "Transformed",
  params: {
    ValidCard: { kind: "literal", raw: validCard },
  },
  effect: { handlerKey: "TrigTransform", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(TransformedTrigger);
});
triggerHandlerRegistry.register(TransformedTrigger);

describe("TransformedTrigger", () => {
  it("is registered under mode 'Transformed'", () => {
    expect(triggerHandlerRegistry.has("Transformed")).toBe(true);
  });

  it("matches when source card transforms (Card.Self)", () => {
    const Cls = triggerHandlerRegistry.lookup("Transformed");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("Transformed", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      toFace: "back" as const,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match when a different card transforms (Card.Self)", () => {
    const Cls = triggerHandlerRegistry.lookup("Transformed");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("Transformed", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      toFace: "back" as const,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("matches any card transforming when ValidCard$ Card", () => {
    const Cls = triggerHandlerRegistry.lookup("Transformed");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card"), mkCtx());
    const ev = mkEvent("Transformed", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      toFace: "front" as const,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match a non-Transformed event", () => {
    const Cls = triggerHandlerRegistry.lookup("Transformed");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(false);
  });

  it("has correct identity fields", () => {
    const Cls = triggerHandlerRegistry.lookup("Transformed");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
    expect(ta.isDelayed).toBe(false);
  });
});

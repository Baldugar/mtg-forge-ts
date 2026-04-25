// SPDX-License-Identifier: GPL-3.0-or-later
// TapsTrigger / TapTrigger tests — Wave 9.
// Verifies both mode registrations and CardTapped event matching.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TapTrigger, TapsTrigger } from "./taps-trigger.js";

const SOURCE_ID = mkEntityId(80);
const OTHER_ID = mkEntityId(81);
const TRIGGER_ID = mkEntityId(10);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (mode: string, validCard = "Card.Self"): TriggerAst => ({
  mode,
  params: {
    ValidCard: { kind: "literal", raw: validCard },
  },
  effect: { handlerKey: "TrigTap", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(TapsTrigger);
  triggerHandlerRegistry.register(TapTrigger);
});
triggerHandlerRegistry.register(TapsTrigger);
triggerHandlerRegistry.register(TapTrigger);

describe("TapsTrigger", () => {
  it("is registered under mode 'Taps'", () => {
    expect(triggerHandlerRegistry.has("Taps")).toBe(true);
  });

  it("matches when source card is tapped (Card.Self)", () => {
    const Cls = triggerHandlerRegistry.lookup("Taps");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Taps"), mkCtx());
    const ev = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match when a different card is tapped (Card.Self)", () => {
    const Cls = triggerHandlerRegistry.lookup("Taps");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Taps"), mkCtx());
    const ev = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: OTHER_ID });
    expect(ta.matches(ev)).toBe(false);
  });

  it("matches any card being tapped when ValidCard$ Card", () => {
    const Cls = triggerHandlerRegistry.lookup("Taps");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Taps", "Card"), mkCtx());
    const ev = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: OTHER_ID });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match a non-CardTapped event", () => {
    const Cls = triggerHandlerRegistry.lookup("Taps");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Taps"), mkCtx());
    const ev = mkEvent("CardUntapped", 1, PhaseStep.Untap, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("TapTrigger (singular mode)", () => {
  it("is registered under mode 'Tap'", () => {
    expect(triggerHandlerRegistry.has("Tap")).toBe(true);
  });

  it("matches when source card is tapped (Card.Self)", () => {
    const Cls = triggerHandlerRegistry.lookup("Tap");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Tap"), mkCtx());
    const ev = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(true);
  });
});

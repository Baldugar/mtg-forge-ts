// SPDX-License-Identifier: GPL-3.0-or-later
// LifeGainedTrigger tests.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import { LifeGainedTrigger } from "./life-gained-trigger.js";

const SEAT_0 = mkPlayerSeat(0);
const SEAT_1 = mkPlayerSeat(1);
const SOURCE_ID = mkEntityId(10);
const TRIGGER_ID = mkEntityId(1);

const mkAst = (validPlayer = "You"): TriggerAst => ({
  mode: "LifeGained",
  params: { ValidPlayer: { kind: "literal", raw: validPlayer } },
  effect: { handlerKey: "TrigPump", params: {} },
});

const mkCtx = () => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: SEAT_0,
  triggerId: TRIGGER_ID,
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(LifeGainedTrigger);
});
triggerHandlerRegistry.register(LifeGainedTrigger);

describe("LifeGainedTrigger", () => {
  it("is registered under mode 'LifeGained'", () => {
    expect(triggerHandlerRegistry.has("LifeGained")).toBe(true);
  });

  it("You — matches when controller gains life (positive delta)", () => {
    const Cls = triggerHandlerRegistry.lookup("LifeGained");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("You"), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      oldLife: 20,
      newLife: 23,
      delta: 3,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("You — does NOT match when life decreases", () => {
    const Cls = triggerHandlerRegistry.lookup("LifeGained");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("You"), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      oldLife: 20,
      newLife: 17,
      delta: -3,
      cause: "damage",
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("You — does NOT match when opponent gains life", () => {
    const Cls = triggerHandlerRegistry.lookup("LifeGained");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("You"), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: SEAT_1,
      oldLife: 20,
      newLife: 23,
      delta: 3,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("Opponent — matches when opponent gains life", () => {
    const Cls = triggerHandlerRegistry.lookup("LifeGained");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Opponent"), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: SEAT_1,
      oldLife: 20,
      newLife: 23,
      delta: 3,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Player — matches any player gaining life", () => {
    const Cls = triggerHandlerRegistry.lookup("LifeGained");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Player"), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: SEAT_1,
      oldLife: 20,
      newLife: 25,
      delta: 5,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match non-LifeChanged events", () => {
    const Cls = triggerHandlerRegistry.lookup("LifeGained");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("CardDrawn", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      cardId: SOURCE_ID,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

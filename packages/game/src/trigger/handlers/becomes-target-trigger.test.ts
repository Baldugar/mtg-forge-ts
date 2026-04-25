// SPDX-License-Identifier: GPL-3.0-or-later
// BecomesTargetTrigger tests — verifies Wave 5 CardTargeted matching.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import { BecomesTargetTrigger } from "./becomes-target-trigger.js";

const SEAT_0 = mkPlayerSeat(0);
const SEAT_1 = mkPlayerSeat(1);
const SOURCE_ID = mkEntityId(10);
const OTHER_ID = mkEntityId(20);
const TRIGGER_ID = mkEntityId(1);

const mkAst = (validCard = "Card.Self", validSource = "Spell.OpponentCtrl"): TriggerAst => ({
  mode: "BecomesTarget",
  params: {
    ValidCard: { kind: "literal", raw: validCard },
    ValidSource: { kind: "literal", raw: validSource },
  },
  effect: { handlerKey: "TrigDestroy", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(BecomesTargetTrigger);
});
triggerHandlerRegistry.register(BecomesTargetTrigger);

describe("BecomesTargetTrigger", () => {
  it("is registered under mode 'BecomesTarget'", () => {
    expect(triggerHandlerRegistry.has("BecomesTarget")).toBe(true);
  });

  it("matches CardTargeted when self is targeted by opponent spell", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self", "Spell.OpponentCtrl"), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardTargeted", 1, PhaseStep.Main1, {
      targetId: SOURCE_ID,
      sourceCardId: OTHER_ID,
      targetingSeat: SEAT_1, // opponent
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match when self is targeted by own spell (Spell.OpponentCtrl filter)", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self", "Spell.OpponentCtrl"), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardTargeted", 1, PhaseStep.Main1, {
      targetId: SOURCE_ID,
      sourceCardId: OTHER_ID,
      targetingSeat: SEAT_0, // own spell
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT match when a different card is targeted (Card.Self filter)", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self", "Spell.OpponentCtrl"), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardTargeted", 1, PhaseStep.Main1, {
      targetId: OTHER_ID, // different card
      sourceCardId: mkEntityId(30),
      targetingSeat: SEAT_1,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT match non-CardTargeted events", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardDrawn", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      cardId: SOURCE_ID,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("matches any card when ValidCard$ is 'Card'", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card", "Spell"), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardTargeted", 1, PhaseStep.Main1, {
      targetId: OTHER_ID, // any card
      sourceCardId: mkEntityId(30),
      targetingSeat: SEAT_1,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("identity fields are correct", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
  });
});

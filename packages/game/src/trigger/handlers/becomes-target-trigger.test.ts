// SPDX-License-Identifier: GPL-3.0-or-later
// BecomesTargetTrigger tests — verifies registration and stub behavior.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import { BecomesTargetTrigger } from "./becomes-target-trigger.js";

const SEAT_0 = mkPlayerSeat(0);
const SOURCE_ID = mkEntityId(10);
const TRIGGER_ID = mkEntityId(1);

const mkAst = (): TriggerAst => ({
  mode: "BecomesTarget",
  params: {
    ValidCard: { kind: "literal", raw: "Card.Self" },
    ValidSource: { kind: "literal", raw: "Spell.OpponentCtrl" },
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

  it("matches() always returns false (stub — no CardTargeted event yet)", () => {
    const Cls = triggerHandlerRegistry.lookup("BecomesTarget");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    // Any event should return false since we're waiting for CardTargeted event kind.
    const ev = mkEvent("CardDrawn", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      cardId: SOURCE_ID,
    });
    expect(ta.matches(ev)).toBe(false);
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

// SPDX-License-Identifier: GPL-3.0-or-later
// SacrificedTrigger tests.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import { SacrificedTrigger } from "./sacrificed-trigger.js";

const SEAT_0 = mkPlayerSeat(0);
const SEAT_1 = mkPlayerSeat(1);
const SOURCE_ID = mkEntityId(10);
const TRIGGER_ID = mkEntityId(1);
const CARD_A = mkEntityId(20);

const mkAst = (validCard = "Card.Self"): TriggerAst => ({
  mode: "Sacrificed",
  params: { ValidCard: { kind: "literal", raw: validCard } },
  effect: { handlerKey: "TrigEffect", params: {} },
});

const mkCtx = () => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: SEAT_0,
  triggerId: TRIGGER_ID,
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(SacrificedTrigger);
});
triggerHandlerRegistry.register(SacrificedTrigger);

describe("SacrificedTrigger", () => {
  it("is registered under mode 'Sacrificed'", () => {
    expect(triggerHandlerRegistry.has("Sacrificed")).toBe(true);
  });

  it("Card.Self — matches when source card is sacrificed", () => {
    const Cls = triggerHandlerRegistry.lookup("Sacrificed");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const ev = mkEvent("CardSacrificed", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      playerSeat: SEAT_0,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Card.Self — does NOT match when a different card is sacrificed", () => {
    const Cls = triggerHandlerRegistry.lookup("Sacrificed");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const ev = mkEvent("CardSacrificed", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_0,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("Card — matches any sacrificed card", () => {
    const Cls = triggerHandlerRegistry.lookup("Sacrificed");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card"), mkCtx());
    const ev = mkEvent("CardSacrificed", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_1,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Card.YouCtrl — matches when controller sacrifices", () => {
    const Cls = triggerHandlerRegistry.lookup("Sacrificed");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.YouCtrl"), mkCtx());
    const ev = mkEvent("CardSacrificed", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_0,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Card.YouCtrl — does NOT match when opponent sacrifices", () => {
    const Cls = triggerHandlerRegistry.lookup("Sacrificed");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.YouCtrl"), mkCtx());
    const ev = mkEvent("CardSacrificed", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_1,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT match non-CardSacrificed events", () => {
    const Cls = triggerHandlerRegistry.lookup("Sacrificed");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("CardDrawn", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      cardId: SOURCE_ID,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

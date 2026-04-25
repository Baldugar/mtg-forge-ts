// SPDX-License-Identifier: GPL-3.0-or-later
// DiscardedTrigger tests.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import { DiscardedTrigger } from "./discarded-trigger.js";

const SEAT_0 = mkPlayerSeat(0);
const SEAT_1 = mkPlayerSeat(1);
const SOURCE_ID = mkEntityId(10);
const TRIGGER_ID = mkEntityId(1);
const CARD_A = mkEntityId(20);

const mkAst = (validCard = "Card.Self"): TriggerAst => ({
  mode: "Discarded",
  params: { ValidCard: { kind: "literal", raw: validCard } },
  effect: { handlerKey: "TrigCast", params: {} },
});

const mkCtx = () => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: SEAT_0,
  triggerId: TRIGGER_ID,
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(DiscardedTrigger);
});
triggerHandlerRegistry.register(DiscardedTrigger);

describe("DiscardedTrigger", () => {
  it("is registered under mode 'Discarded'", () => {
    expect(triggerHandlerRegistry.has("Discarded")).toBe(true);
  });

  it("Card.Self — matches when source card is discarded", () => {
    const Cls = triggerHandlerRegistry.lookup("Discarded");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const ev = mkEvent("CardDiscarded", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      playerSeat: SEAT_0,
      cause: "discard" as const,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Card.Self — does NOT match when a different card is discarded", () => {
    const Cls = triggerHandlerRegistry.lookup("Discarded");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const ev = mkEvent("CardDiscarded", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_0,
      cause: "discard" as const,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("Card — matches any discarded card", () => {
    const Cls = triggerHandlerRegistry.lookup("Discarded");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card"), mkCtx());
    const ev = mkEvent("CardDiscarded", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_1,
      cause: "discard" as const,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Card.YouCtrl — matches when controller discards", () => {
    const Cls = triggerHandlerRegistry.lookup("Discarded");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.YouCtrl"), mkCtx());
    const ev = mkEvent("CardDiscarded", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_0,
      cause: "discard" as const,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("Card.OpponentCtrl — matches when opponent discards", () => {
    const Cls = triggerHandlerRegistry.lookup("Discarded");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.OpponentCtrl"), mkCtx());
    const ev = mkEvent("CardDiscarded", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      playerSeat: SEAT_1,
      cause: "discard" as const,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match non-CardDiscarded events", () => {
    const Cls = triggerHandlerRegistry.lookup("Discarded");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("CardDrawn", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      cardId: SOURCE_ID,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

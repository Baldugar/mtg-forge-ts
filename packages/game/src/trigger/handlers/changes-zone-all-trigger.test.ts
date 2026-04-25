// SPDX-License-Identifier: GPL-3.0-or-later
// ChangesZoneAllTrigger tests — verifies registration and matches() logic.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import { ChangesZoneAllTrigger } from "./changes-zone-all-trigger.js";

// Stub game with minimal layerEngine for filter checks.
const SEAT_0 = mkPlayerSeat(0);
const SEAT_1 = mkPlayerSeat(1);

const mkCard = (seat = SEAT_0) => ({
  controllerSeat: seat,
  paperCard: { definition: undefined, name: "?" },
});

const mkGameStub = (cards: Map<number, ReturnType<typeof mkCard>>) => ({
  layerEngine: {
    computeCharacteristics: (_id: number) => ({
      types: new Set(["Creature"]),
    }),
  },
  cards,
});

const SOURCE_ID = mkEntityId(10);
const TRIGGER_ID = mkEntityId(1);
const CARD_A = mkEntityId(20);
const CARD_B = mkEntityId(21);

const mkAst = (validCards = "Creature", dest = "Graveyard", origin = "Battlefield"): TriggerAst => ({
  mode: "ChangesZoneAll",
  params: {
    Origin: { kind: "literal", raw: origin },
    Destination: { kind: "literal", raw: dest },
    ValidCards: { kind: "literal", raw: validCards },
  },
  effect: { handlerKey: "TrigDeath", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(ChangesZoneAllTrigger);
});
triggerHandlerRegistry.register(ChangesZoneAllTrigger);

describe("ChangesZoneAllTrigger", () => {
  it("is registered under mode 'ChangesZoneAll'", () => {
    expect(triggerHandlerRegistry.has("ChangesZoneAll")).toBe(true);
  });

  it("matches a Creature moving to Graveyard from Battlefield", () => {
    const cards = new Map([[CARD_A as number, mkCard(SEAT_0)]]);
    const game = mkGameStub(cards);
    const Cls = triggerHandlerRegistry.lookup("ChangesZoneAll");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match when origin zone is wrong", () => {
    const cards = new Map([[CARD_A as number, mkCard(SEAT_0)]]);
    const game = mkGameStub(cards);
    const Cls = triggerHandlerRegistry.lookup("ChangesZoneAll");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Graveyard,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT match when destination zone is wrong", () => {
    const cards = new Map([[CARD_A as number, mkCard(SEAT_0)]]);
    const game = mkGameStub(cards);
    const Cls = triggerHandlerRegistry.lookup("ChangesZoneAll");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Exile,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("YouCtrl — matches creature controlled by controller", () => {
    const cards = new Map([[CARD_A as number, mkCard(SEAT_0)]]);
    const game = mkGameStub(cards);
    const Cls = triggerHandlerRegistry.lookup("ChangesZoneAll");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Creature.YouCtrl"), {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: CARD_A,
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("YouCtrl — does NOT match opponent's creature", () => {
    const cards = new Map([[CARD_B as number, mkCard(SEAT_1)]]);
    const game = mkGameStub(cards);
    const Cls = triggerHandlerRegistry.lookup("ChangesZoneAll");
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Creature.YouCtrl"), {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: CARD_B,
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT match non-CardChangedZone events", () => {
    const cards = new Map([[CARD_A as number, mkCard(SEAT_0)]]);
    const game = mkGameStub(cards);
    const Cls = triggerHandlerRegistry.lookup("ChangesZoneAll");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: SEAT_0,
      triggerId: TRIGGER_ID,
    });
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: SEAT_0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

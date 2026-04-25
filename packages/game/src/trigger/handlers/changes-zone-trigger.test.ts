// SPDX-License-Identifier: GPL-3.0-or-later
// Task 2 — ChangesZoneTrigger tests.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Import for side-effect to register ChangesZoneTrigger at module load time.
import { ChangesZoneTrigger } from "./changes-zone-trigger.js";

const SOURCE_ID = mkEntityId(10);
const OTHER_ID = mkEntityId(99);
const TRIGGER_ID = mkEntityId(1);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkEtbAst = (): TriggerAst => ({
  mode: "ChangesZone",
  params: {
    Origin: { kind: "literal", raw: "Any" },
    Destination: { kind: "literal", raw: "Battlefield" },
    ValidCard: { kind: "literal", raw: "Card.Self" },
  },
  effect: { handlerKey: "TrigDraw", params: {} },
});

const mkCardChangedZoneEvent = (
  cardId: ReturnType<typeof mkEntityId>,
  fromZone: ZoneType,
  toZone: ZoneType,
) =>
  mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
    cardId,
    fromZone,
    toZone,
  });

// Re-register after each clear since afterEach clears the registry
afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(ChangesZoneTrigger);
});

// Ensure the handler is registered before all tests in this file
triggerHandlerRegistry.register(ChangesZoneTrigger);

describe("ChangesZoneTrigger", () => {
  it("is registered under mode 'ChangesZone'", () => {
    expect(triggerHandlerRegistry.has("ChangesZone")).toBe(true);
  });

  describe("ETB self-trigger (ValidCard$ Card.Self)", () => {
    it("matches when the source card enters battlefield from any zone", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when a different card enters battlefield", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const event = mkCardChangedZoneEvent(OTHER_ID, ZoneType.Hand, ZoneType.Battlefield);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match when the source card enters graveyard (wrong destination)", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match a non-CardChangedZone event", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const lifeEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
        playerSeat: CONTROLLER,
        oldLife: 20,
        newLife: 18,
        delta: -2,
        cause: "effect",
      });
      expect(ta.matches(lifeEvent)).toBe(false);
    });
  });

  describe("LTB self-trigger (Origin$ Battlefield, Destination$ Any)", () => {
    it("matches when source card leaves battlefield", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ltbAst: TriggerAst = {
        mode: "ChangesZone",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Any" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        effect: { handlerKey: "TrigLTB", params: {} },
      };
      const ta = new Cls().build(ltbAst, mkCtx());

      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when card enters (wrong origin)", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ltbAst: TriggerAst = {
        mode: "ChangesZone",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Any" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        effect: { handlerKey: "TrigLTB", params: {} },
      };
      const ta = new Cls().build(ltbAst, mkCtx());

      // Card moving Hand → Battlefield — wrong origin
      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield);
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("global watcher (ValidCard$ Card)", () => {
    it("matches any card moving to graveyard", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const watcherAst: TriggerAst = {
        mode: "ChangesZone",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Graveyard" },
          ValidCard: { kind: "literal", raw: "Card" },
        },
        effect: { handlerKey: "TrigWatch", params: {} },
      };
      const ta = new Cls().build(watcherAst, mkCtx());

      const event = mkCardChangedZoneEvent(OTHER_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ta.matches(event)).toBe(true);
    });
  });

  describe("TriggeredAbility identity fields", () => {
    it("has correct id, sourceCardId, controllerSeatAtReg, kind", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
    });
  });
});

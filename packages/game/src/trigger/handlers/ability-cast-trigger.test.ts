// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 9 — AbilityCastTrigger tests. Verify the trigger correctly matches
// AbilityActivated game events with ValidCard$ Card.Self / Card / Card.YouCtrl
// / Card.OpponentCtrl, and ignores non-AbilityActivated events.
//
// Pairs with the existing SpellCastTrigger (which only fires on SpellCast
// events) — together they cover the activated-vs-cast trigger taxonomy.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { AbilityCastTrigger } from "./ability-cast-trigger.js";

const SOURCE_ID = mkEntityId(40);
const OTHER_ID = mkEntityId(41);
const STACK_ID = mkEntityId(999);
const TRIGGER_ID = mkEntityId(4);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAbilityActivatedEvent = (sourceCardId: ReturnType<typeof mkEntityId>, ctrl = CONTROLLER) =>
  mkEvent("AbilityActivated", 1, PhaseStep.Main1, {
    stackItemId: STACK_ID,
    sourceCardId,
    controllerSeat: ctrl,
    abilityKind: "activated" as const,
  });

const mkAst = (validCard?: string): TriggerAst => ({
  mode: "AbilityCast",
  params: validCard ? { ValidCard: { kind: "literal", raw: validCard } } : {},
  effect: { handlerKey: "TrigDraw", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(AbilityCastTrigger);
});

triggerHandlerRegistry.register(AbilityCastTrigger);

describe("AbilityCastTrigger", () => {
  it("is registered under mode 'AbilityCast'", () => {
    expect(triggerHandlerRegistry.has("AbilityCast")).toBe(true);
  });

  describe("ValidCard$ Card.Self (default)", () => {
    it("matches when activated ability comes from this card", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst(), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(SOURCE_ID))).toBe(true);
    });

    it("does NOT match when activated ability comes from another card", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst(), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(OTHER_ID))).toBe(false);
    });
  });

  describe("ValidCard$ Card (any source)", () => {
    it("matches any AbilityActivated event regardless of source", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card"), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(SOURCE_ID))).toBe(true);
      expect(ta.matches(mkAbilityActivatedEvent(OTHER_ID))).toBe(true);
    });
  });

  describe("ValidCard$ Card.YouCtrl", () => {
    it("matches when activator controls the ability source", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card.YouCtrl"), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(OTHER_ID, CONTROLLER))).toBe(true);
    });

    it("does NOT match when opponent controls the ability source", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card.YouCtrl"), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(OTHER_ID, OPPONENT))).toBe(false);
    });
  });

  describe("ValidCard$ Card.OpponentCtrl", () => {
    it("matches when opponent controls the ability source", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card.OpponentCtrl"), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(OTHER_ID, OPPONENT))).toBe(true);
    });

    it("does NOT match when controller activates", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card.OpponentCtrl"), mkCtx());
      expect(ta.matches(mkAbilityActivatedEvent(OTHER_ID, CONTROLLER))).toBe(false);
    });
  });

  describe("Wrong-event rejection", () => {
    it("does NOT match a SpellCast event (only AbilityActivated)", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card"), mkCtx());
      const spellCast = mkEvent("SpellCast", 1, PhaseStep.Main1, {
        stackItemId: STACK_ID,
        cardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
      });
      expect(ta.matches(spellCast)).toBe(false);
    });

    it("does NOT match a CardChangedZone event", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst("Card"), mkCtx());
      const zoneChange = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
        cardId: SOURCE_ID,
        fromZone: 0 as never,
        toZone: 1 as never,
      });
      expect(ta.matches(zoneChange)).toBe(false);
    });
  });

  describe("Identity fields", () => {
    it("populates id, sourceCardId, controllerSeatAtReg from build context", () => {
      const handler = new AbilityCastTrigger();
      const ta = handler.build(mkAst(), mkCtx());
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.kind).toBe("triggered");
      expect(ta.isDelayed).toBe(false);
    });
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Task 1 — AttacksTrigger tests (TDD, written before implementation).
// Covers: AttackersDeclared event matching, ValidCard$ variants (Card.Self,
// Card, Card.YouCtrl), wrong-event rejection, identity fields.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { AttacksTrigger } from "./attacks-trigger.js";

const SOURCE_ID = mkEntityId(30);
const OTHER_ID = mkEntityId(31);
const TRIGGER_ID = mkEntityId(3);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

/** Build an AttackersDeclared event with a single attacker. */
const mkAttackersDeclaredEvent = (
  attackerId: ReturnType<typeof mkEntityId>,
  attackingSeat: ReturnType<typeof mkPlayerSeat>,
) =>
  mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
    attackingSeat,
    attackers: [
      {
        attackerId,
        defender: { kind: "player" as const, seat: OPPONENT },
      },
    ],
  });

/** Build an AttackersDeclared event with multiple attackers. */
const mkMultiAttackerEvent = (
  attackerIds: ReturnType<typeof mkEntityId>[],
  attackingSeat: ReturnType<typeof mkPlayerSeat>,
) =>
  mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
    attackingSeat,
    attackers: attackerIds.map((id) => ({
      attackerId: id,
      defender: { kind: "player" as const, seat: OPPONENT },
    })),
  });

const mkSelfAst = (): TriggerAst => ({
  mode: "Attacks",
  params: {
    ValidCard: { kind: "literal", raw: "Card.Self" },
  },
  effect: { handlerKey: "TrigPump", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(AttacksTrigger);
});

triggerHandlerRegistry.register(AttacksTrigger);

describe("AttacksTrigger", () => {
  it("is registered under mode 'Attacks'", () => {
    expect(triggerHandlerRegistry.has("Attacks")).toBe(true);
  });

  describe("ValidCard$ Card.Self", () => {
    it("matches when the source card is among the attackers", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkSelfAst(), mkCtx());

      const event = mkAttackersDeclaredEvent(SOURCE_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when a different card attacks (source not in list)", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkSelfAst(), mkCtx());

      const event = mkAttackersDeclaredEvent(OTHER_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(false);
    });

    it("matches when source is one of multiple attackers", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkSelfAst(), mkCtx());

      const event = mkMultiAttackerEvent([OTHER_ID, SOURCE_ID], CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });
  });

  describe("ValidCard$ Card (any attacker)", () => {
    it("matches when any card attacks", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const anyAst: TriggerAst = {
        mode: "Attacks",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
        },
        effect: { handlerKey: "TrigGlobal", params: {} },
      };
      const ta = new Cls().build(anyAst, mkCtx());

      const event = mkAttackersDeclaredEvent(OTHER_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when no attackers are declared (empty array)", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const anyAst: TriggerAst = {
        mode: "Attacks",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
        },
        effect: { handlerKey: "TrigGlobal", params: {} },
      };
      const ta = new Cls().build(anyAst, mkCtx());

      const event = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
        attackingSeat: CONTROLLER,
        attackers: [],
      });
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("ValidCard$ Card.YouCtrl (any attacker controller controls)", () => {
    it("matches when a creature controller controls attacks", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const youCtrlAst: TriggerAst = {
        mode: "Attacks",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
        },
        effect: { handlerKey: "TrigYou", params: {} },
      };
      const ta = new Cls().build(youCtrlAst, mkCtx());

      // Controller attacks — attackingSeat === controllerSeat
      const event = mkAttackersDeclaredEvent(OTHER_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when opponent attacks (Card.YouCtrl)", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const youCtrlAst: TriggerAst = {
        mode: "Attacks",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
        },
        effect: { handlerKey: "TrigYou", params: {} },
      };
      const ta = new Cls().build(youCtrlAst, mkCtx());

      // Opponent attacks — attackingSeat !== controllerSeat
      const event = mkAttackersDeclaredEvent(OTHER_ID, OPPONENT);
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("wrong event kind", () => {
    it("does NOT match a non-AttackersDeclared event", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkSelfAst(), mkCtx());

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

  describe("TriggeredAbility identity fields", () => {
    it("has correct id, sourceCardId, controllerSeatAtReg, kind, isDelayed", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkSelfAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
    });
  });

  describe("resolver stamp", () => {
    it("has a non-null resolver after build()", () => {
      const Cls = triggerHandlerRegistry.lookup("Attacks");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkSelfAst(), mkCtx());

      const resolver = (ta as unknown as { resolver?: unknown }).resolver;
      expect(resolver).not.toBeNull();
      expect(resolver).not.toBeUndefined();
      expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
    });
  });
});

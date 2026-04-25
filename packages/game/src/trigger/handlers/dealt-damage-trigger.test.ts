// SPDX-License-Identifier: GPL-3.0-or-later
// Task 3 — DealtDamageTrigger tests (TDD, written before implementation).
// Covers: DamageDealt event matching, ValidSource$ variants (Card.Self, Card,
// Card.YouCtrl), ValidTarget$ variants (Player, Creature, Any),
// CombatDamage$ True/False/absent, wrong-event rejection, identity fields,
// resolver stamping.
//
// Registry key: "DamageDone" (Forge DSL name for Mode$ DamageDone).
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { DealtDamageTrigger } from "./dealt-damage-trigger.js";

const SOURCE_ID = mkEntityId(50);
const OTHER_SOURCE_ID = mkEntityId(51);
const TARGET_CREATURE_ID = mkEntityId(60);
const TRIGGER_ID = mkEntityId(5);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

/** Build a DamageDealt event targeting a player. */
const mkPlayerDamageEvent = (
  sourceId: ReturnType<typeof mkEntityId>,
  targetSeat: ReturnType<typeof mkPlayerSeat>,
  amount = 2,
  isCombat = true,
) =>
  mkEvent("DamageDealt", 1, PhaseStep.CombatDamage, {
    sourceId,
    targetKind: "player" as const,
    targetId: targetSeat,
    amount,
    isCombat,
  });

/** Build a DamageDealt event targeting a creature. */
const mkCreatureDamageEvent = (
  sourceId: ReturnType<typeof mkEntityId>,
  targetId: ReturnType<typeof mkEntityId>,
  amount = 2,
  isCombat = true,
) =>
  mkEvent("DamageDealt", 1, PhaseStep.CombatDamage, {
    sourceId,
    targetKind: "creature" as const,
    targetId,
    amount,
    isCombat,
  });

/** Ophidian-style AST: this deals combat damage to a player. */
const mkOphidianAst = (): TriggerAst => ({
  mode: "DamageDone",
  params: {
    ValidSource: { kind: "literal", raw: "Card.Self" },
    ValidTarget: { kind: "literal", raw: "Player" },
    CombatDamage: { kind: "literal", raw: "True" },
  },
  effect: { handlerKey: "TrigDraw", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(DealtDamageTrigger);
});

triggerHandlerRegistry.register(DealtDamageTrigger);

describe("DealtDamageTrigger", () => {
  it("is registered under mode 'DamageDone' (Forge DSL name)", () => {
    expect(triggerHandlerRegistry.has("DamageDone")).toBe(true);
  });

  describe("Ophidian pattern — ValidSource$ Card.Self + ValidTarget$ Player + CombatDamage$ True", () => {
    it("matches when source deals combat damage to a player", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

      const event = mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 3, true);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when a different source deals combat damage to a player", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

      const event = mkPlayerDamageEvent(OTHER_SOURCE_ID, OPPONENT, 3, true);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match when source deals non-combat damage to a player (CombatDamage$ True)", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

      const event = mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 3, false);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match when source deals combat damage to a creature (ValidTarget$ Player)", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

      const event = mkCreatureDamageEvent(SOURCE_ID, TARGET_CREATURE_ID, 3, true);
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("ValidSource$ Card (any source)", () => {
    it("matches when any source deals damage", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const anySourceAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card" },
          ValidTarget: { kind: "literal", raw: "Any" },
        },
        effect: { handlerKey: "TrigGlobal", params: {} },
      };
      const ta = new Cls().build(anySourceAst, mkCtx());

      expect(ta.matches(mkPlayerDamageEvent(OTHER_SOURCE_ID, OPPONENT))).toBe(true);
      expect(ta.matches(mkCreatureDamageEvent(OTHER_SOURCE_ID, TARGET_CREATURE_ID))).toBe(true);
    });
  });

  describe("ValidTarget$ Creature", () => {
    it("matches when target is a creature", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const creatureTargetAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          ValidTarget: { kind: "literal", raw: "Creature" },
        },
        effect: { handlerKey: "TrigBlock", params: {} },
      };
      const ta = new Cls().build(creatureTargetAst, mkCtx());

      expect(ta.matches(mkCreatureDamageEvent(SOURCE_ID, TARGET_CREATURE_ID, 3, true))).toBe(true);
      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 3, true))).toBe(false);
    });
  });

  describe("ValidTarget$ Any", () => {
    it("matches player and creature targets", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const anyTargetAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          ValidTarget: { kind: "literal", raw: "Any" },
        },
        effect: { handlerKey: "TrigAny", params: {} },
      };
      const ta = new Cls().build(anyTargetAst, mkCtx());

      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT))).toBe(true);
      expect(ta.matches(mkCreatureDamageEvent(SOURCE_ID, TARGET_CREATURE_ID))).toBe(true);
    });
  });

  describe("CombatDamage$ False (noncombat only)", () => {
    it("matches noncombat damage and rejects combat damage", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const noncombatAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          ValidTarget: { kind: "literal", raw: "Player" },
          CombatDamage: { kind: "literal", raw: "False" },
        },
        effect: { handlerKey: "TrigNoncombat", params: {} },
      };
      const ta = new Cls().build(noncombatAst, mkCtx());

      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 2, false))).toBe(true);
      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 2, true))).toBe(false);
    });
  });

  describe("CombatDamage$ absent (either combat or noncombat)", () => {
    it("matches both combat and noncombat damage", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const eitherAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          ValidTarget: { kind: "literal", raw: "Player" },
          // No CombatDamage param
        },
        effect: { handlerKey: "TrigEither", params: {} },
      };
      const ta = new Cls().build(eitherAst, mkCtx());

      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 2, true))).toBe(true);
      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 2, false))).toBe(true);
    });
  });

  describe("ValidTarget$ You / Opponent (specific seat)", () => {
    it("ValidTarget$ Opponent matches when target is the opponent seat", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const oppTargetAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          ValidTarget: { kind: "literal", raw: "Opponent" },
          CombatDamage: { kind: "literal", raw: "True" },
        },
        effect: { handlerKey: "TrigOpp", params: {} },
      };
      const ta = new Cls().build(oppTargetAst, mkCtx());

      // Player opponent seat match
      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, OPPONENT, 2, true))).toBe(true);
      // Player controller seat — not Opponent
      expect(ta.matches(mkPlayerDamageEvent(SOURCE_ID, CONTROLLER, 2, true))).toBe(false);
    });

    it("ValidTarget$ You matches when target is the controller seat", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const youTargetAst: TriggerAst = {
        mode: "DamageDone",
        params: {
          ValidSource: { kind: "literal", raw: "Card" },
          ValidTarget: { kind: "literal", raw: "You" },
        },
        effect: { handlerKey: "TrigYou", params: {} },
      };
      const ta = new Cls().build(youTargetAst, mkCtx());

      expect(ta.matches(mkPlayerDamageEvent(OTHER_SOURCE_ID, CONTROLLER, 2, true))).toBe(true);
      expect(ta.matches(mkPlayerDamageEvent(OTHER_SOURCE_ID, OPPONENT, 2, true))).toBe(false);
    });
  });

  describe("wrong event kind", () => {
    it("does NOT match a non-DamageDealt event", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

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
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
    });
  });

  describe("resolver stamp", () => {
    it("has a non-null resolver after build()", () => {
      const Cls = triggerHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkOphidianAst(), mkCtx());

      const resolver = (ta as unknown as { resolver?: unknown }).resolver;
      expect(resolver).not.toBeNull();
      expect(resolver).not.toBeUndefined();
      expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
    });
  });
});

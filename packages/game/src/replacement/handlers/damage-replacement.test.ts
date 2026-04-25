// SPDX-License-Identifier: GPL-3.0-or-later
// Task 3 — DamageReplacement tests.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
// Import for side-effect to register DamageReplacement at module load time.
import { DamageReplacement } from "./damage-replacement.js";

const SOURCE_ID = mkEntityId(10);
const OTHER_SOURCE = mkEntityId(20);
const CREATURE_ID = mkEntityId(30);
const REPL_ID = mkEntityId(1);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  replacementId: REPL_ID,
});

/** Prevent all damage to you */
const mkPreventAllToYouAst = (): ReplacementAst => ({
  eventKind: "DamageDone",
  params: {
    ValidTarget: { kind: "literal", raw: "You" },
    Prevent: { kind: "literal", raw: "True" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

/** Replace damage with 0 (Amount$ 0) */
const mkZeroDamageAst = (): ReplacementAst => ({
  eventKind: "DamageDone",
  params: {
    ValidTarget: { kind: "literal", raw: "Any" },
    Amount: { kind: "literal", raw: "0" },
  },
  effect: { handlerKey: "ReplAmount", params: {} },
});

/** Double damage from self source */
const mkDoubleFromSelfAst = (): ReplacementAst => ({
  eventKind: "DamageDone",
  params: {
    ValidSource: { kind: "literal", raw: "Card.Self" },
  },
  effect: { handlerKey: "DBDouble", params: {} },
});

/** Prevent damage to creatures */
const mkPreventCreatureDamageAst = (): ReplacementAst => ({
  eventKind: "DamageDone",
  params: {
    ValidTarget: { kind: "literal", raw: "Creature" },
    Prevent: { kind: "literal", raw: "True" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkPlayerDamageIntent = (
  targetSeat: ReturnType<typeof mkPlayerSeat>,
  amount: number,
  sourceId: ReturnType<typeof mkEntityId> = SOURCE_ID,
): MutationIntent => ({
  kind: "damage",
  sourceId,
  targetKind: "player",
  targetId: targetSeat,
  amount,
  isCombat: false,
});

const mkCreatureDamageIntent = (
  targetId: ReturnType<typeof mkEntityId>,
  amount: number,
  sourceId: ReturnType<typeof mkEntityId> = SOURCE_ID,
): MutationIntent => ({
  kind: "damage",
  sourceId,
  targetKind: "creature",
  targetId,
  amount,
  isCombat: false,
});

// Re-register after each clear
afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(DamageReplacement);
});

// Ensure handler is registered before all tests
replacementHandlerRegistry.register(DamageReplacement);

describe("DamageReplacement", () => {
  it("is registered under eventKind 'DamageDone'", () => {
    expect(replacementHandlerRegistry.has("DamageDone")).toBe(true);
  });

  describe("Prevent$ True, ValidTarget$ You — prevent all damage to controller", () => {
    it("matches damage intent targeting controller as player", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventAllToYouAst(), mkCtx());
      const intent = mkPlayerDamageIntent(CONTROLLER, 5);
      expect(ra.matches(intent)).toBe(true);
    });

    it("does NOT match damage intent targeting opponent", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventAllToYouAst(), mkCtx());
      const intent = mkPlayerDamageIntent(OPPONENT, 5);
      expect(ra.matches(intent)).toBe(false);
    });

    it("does NOT match creature damage intent", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventAllToYouAst(), mkCtx());
      const intent = mkCreatureDamageIntent(CREATURE_ID, 3);
      expect(ra.matches(intent)).toBe(false);
    });

    it("apply returns null (damage prevented)", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventAllToYouAst(), mkCtx());
      const intent = mkPlayerDamageIntent(CONTROLLER, 5);
      expect(ra.apply(intent, {} as never)).toBeNull();
    });

    it("does NOT match a non-damage intent kind", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventAllToYouAst(), mkCtx());
      const intent: MutationIntent = {
        kind: "moveTo",
        cardId: SOURCE_ID,
        toZone: "Graveyard" as never,
        toSeat: null,
        cause: "test",
      };
      expect(ra.matches(intent)).toBe(false);
    });
  });

  describe("Amount$ 0 — replace damage amount with 0", () => {
    it("matches any damage intent (ValidTarget$ Any)", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkZeroDamageAst(), mkCtx());
      expect(ra.matches(mkPlayerDamageIntent(CONTROLLER, 7))).toBe(true);
      expect(ra.matches(mkCreatureDamageIntent(CREATURE_ID, 3))).toBe(true);
    });

    it("apply returns intent with amount = 0", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkZeroDamageAst(), mkCtx());
      const intent = mkPlayerDamageIntent(CONTROLLER, 7);
      const result = ra.apply(intent, {} as never) as Record<string, unknown> | null;
      expect(result).not.toBeNull();
      expect(result?.amount).toBe(0);
    });
  });

  describe("ValidSource$ Card.Self filter", () => {
    it("matches damage from source card", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDoubleFromSelfAst(), mkCtx());
      const intent = mkPlayerDamageIntent(OPPONENT, 3, SOURCE_ID);
      expect(ra.matches(intent)).toBe(true);
    });

    it("does NOT match damage from other source", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDoubleFromSelfAst(), mkCtx());
      const intent = mkPlayerDamageIntent(OPPONENT, 3, OTHER_SOURCE);
      expect(ra.matches(intent)).toBe(false);
    });

    it("DBDouble doubles the damage amount", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDoubleFromSelfAst(), mkCtx());
      const intent = mkPlayerDamageIntent(OPPONENT, 3, SOURCE_ID);
      const result = ra.apply(intent, {} as never) as Record<string, unknown> | null;
      expect(result?.amount).toBe(6);
    });
  });

  describe("ValidTarget$ Creature", () => {
    it("matches creature damage", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventCreatureDamageAst(), mkCtx());
      expect(ra.matches(mkCreatureDamageIntent(CREATURE_ID, 3))).toBe(true);
    });

    it("does NOT match player damage", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventCreatureDamageAst(), mkCtx());
      expect(ra.matches(mkPlayerDamageIntent(CONTROLLER, 3))).toBe(false);
    });
  });

  describe("ValidTarget$ Opponent", () => {
    it("matches player damage to non-controller", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ast: ReplacementAst = {
        eventKind: "DamageDone",
        params: { ValidTarget: { kind: "literal", raw: "Opponent" } },
        effect: { handlerKey: "Prevent", params: {} },
      };
      const ra = new Cls().build(ast, mkCtx());
      expect(ra.matches(mkPlayerDamageIntent(OPPONENT, 3))).toBe(true);
      expect(ra.matches(mkPlayerDamageIntent(CONTROLLER, 3))).toBe(false);
    });
  });

  describe("ReplacementAbility identity fields", () => {
    it("has correct id, sourceCardId, kind, layer", () => {
      const Cls = replacementHandlerRegistry.lookup("DamageDone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventAllToYouAst(), mkCtx());
      expect(ra.kind).toBe("replacement");
      expect(ra.id).toBe(REPL_ID);
      expect(ra.sourceCardId).toBe(SOURCE_ID);
      expect(ra.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ra.isSelfReplacement).toBe(false);
      expect(ra.layer).toBe("other");
    });
  });
});

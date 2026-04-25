// SPDX-License-Identifier: GPL-3.0-or-later
// DamageDoneOnceTrigger tests — Wave 9.
// Verifies registration, DamageDealt event matching, and ValidSource$/Target$ filters.
// NOTE: the "once per turn" semantic is NOT tested here — it is deferred to Wave N+1.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { DamageDoneOnceTrigger } from "./damage-done-once-trigger.js";

const SOURCE_ID = mkEntityId(70);
const OTHER_ID = mkEntityId(71);
const CREATURE_ID = mkEntityId(72);
const TRIGGER_ID = mkEntityId(9);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (validSource = "Card.Self", validTarget = "Player"): TriggerAst => ({
  mode: "DamageDoneOnce",
  params: {
    ValidSource: { kind: "literal", raw: validSource },
    ValidTarget: { kind: "literal", raw: validTarget },
  },
  effect: { handlerKey: "TrigOnce", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(DamageDoneOnceTrigger);
});
triggerHandlerRegistry.register(DamageDoneOnceTrigger);

describe("DamageDoneOnceTrigger", () => {
  it("is registered under mode 'DamageDoneOnce'", () => {
    expect(triggerHandlerRegistry.has("DamageDoneOnce")).toBe(true);
  });

  it("matches when source deals damage to a player (Card.Self + Player)", () => {
    const Cls = triggerHandlerRegistry.lookup("DamageDoneOnce");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("DamageDealt", 1, PhaseStep.CombatDamage, {
      sourceId: SOURCE_ID,
      targetKind: "player" as const,
      targetId: OPPONENT,
      amount: 2,
      isCombat: true,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT match when a different source deals damage (Card.Self filter)", () => {
    const Cls = triggerHandlerRegistry.lookup("DamageDoneOnce");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("DamageDealt", 1, PhaseStep.CombatDamage, {
      sourceId: OTHER_ID,
      targetKind: "player" as const,
      targetId: OPPONENT,
      amount: 2,
      isCombat: true,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT match a non-DamageDealt event", () => {
    const Cls = triggerHandlerRegistry.lookup("DamageDoneOnce");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("matches when source deals damage to a creature (ValidTarget$ Creature)", () => {
    const Cls = triggerHandlerRegistry.lookup("DamageDoneOnce");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self", "Creature"), mkCtx());
    const ev = mkEvent("DamageDealt", 1, PhaseStep.CombatDamage, {
      sourceId: SOURCE_ID,
      targetKind: "creature" as const,
      targetId: CREATURE_ID,
      amount: 2,
      isCombat: true,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("has correct identity fields", () => {
    const Cls = triggerHandlerRegistry.lookup("DamageDoneOnce");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
    expect(ta.isDelayed).toBe(false);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// AttackerBlockedByCreatureTrigger tests — per-blocker variant trigger.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { AttackerBlockedByCreatureTrigger } from "./attacker-blocked-by-creature-trigger.js";

const SOURCE_ID = mkEntityId(30);
const BLOCKER_ID = mkEntityId(40);
const OTHER_ATTACKER_ID = mkEntityId(50);
const TRIGGER_ID = mkEntityId(3);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkSourceBlockedEvent = (blockerIds: ReturnType<typeof mkEntityId>[]) =>
  mkEvent("BlockersDeclared", 1, PhaseStep.DeclareBlockers, {
    defendingSeat: OPPONENT,
    blocks: [{ attackerId: SOURCE_ID, blockerIds }],
  });

const mkOtherBlockedEvent = (blockerIds: ReturnType<typeof mkEntityId>[]) =>
  mkEvent("BlockersDeclared", 1, PhaseStep.DeclareBlockers, {
    defendingSeat: OPPONENT,
    blocks: [{ attackerId: OTHER_ATTACKER_ID, blockerIds }],
  });

const mkAst = (validCard?: string, validBlocker?: string): TriggerAst => ({
  mode: "AttackerBlockedByCreature",
  params: {
    ...(validCard !== undefined ? { ValidCard: { kind: "literal" as const, raw: validCard } } : {}),
    ...(validBlocker !== undefined ? { ValidBlocker: { kind: "literal" as const, raw: validBlocker } } : {}),
  },
  effect: { handlerKey: "TrigEffect", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(AttackerBlockedByCreatureTrigger);
});

triggerHandlerRegistry.register(AttackerBlockedByCreatureTrigger);

describe("AttackerBlockedByCreatureTrigger", () => {
  it("is registered under mode 'AttackerBlockedByCreature'", () => {
    expect(triggerHandlerRegistry.has("AttackerBlockedByCreature")).toBe(true);
  });

  describe("ValidCard$ Card.Self (default)", () => {
    it("matches when source is the attacker and has blockers", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card.Self", "Creature.OpponentCtrl"), mkCtx());
      expect(ta.matches(mkSourceBlockedEvent([BLOCKER_ID]))).toBe(true);
    });

    it("does NOT match when source is attacker but has NO blockers", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
      expect(ta.matches(mkSourceBlockedEvent([]))).toBe(false);
    });

    it("does NOT match when a DIFFERENT attacker is blocked", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
      expect(ta.matches(mkOtherBlockedEvent([BLOCKER_ID]))).toBe(false);
    });

    it("defaults to Card.Self when ValidCard$ absent", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst(), mkCtx());
      expect(ta.matches(mkSourceBlockedEvent([BLOCKER_ID]))).toBe(true);
      expect(ta.matches(mkOtherBlockedEvent([BLOCKER_ID]))).toBe(false);
    });
  });

  describe("ValidCard$ Card (any blocked attacker)", () => {
    it("matches when any attacker is blocked by a creature", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Card"), mkCtx());
      expect(ta.matches(mkOtherBlockedEvent([BLOCKER_ID]))).toBe(true);
    });
  });

  it("does NOT match a non-BlockersDeclared event", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const wrongEvent = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
      attackingSeat: CONTROLLER,
      attackers: [{ attackerId: SOURCE_ID, defender: { kind: "player" as const, seat: OPPONENT } }],
    });
    expect(ta.matches(wrongEvent)).toBe(false);
  });

  it("does NOT match when blocks array is empty", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card"), mkCtx());
    const emptyEvent = mkEvent("BlockersDeclared", 1, PhaseStep.DeclareBlockers, {
      defendingSeat: OPPONENT,
      blocks: [],
    });
    expect(ta.matches(emptyEvent)).toBe(false);
  });

  it("has correct identity fields", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
    expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
    expect(ta.isDelayed).toBe(false);
  });

  it("has a non-null resolver", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackerBlockedByCreature");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("Card.Self"), mkCtx());
    const resolver = (ta as unknown as { resolver?: unknown }).resolver;
    expect(resolver).not.toBeNull();
    expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
  });
});

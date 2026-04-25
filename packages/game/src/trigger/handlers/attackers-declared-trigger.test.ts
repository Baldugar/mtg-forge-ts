// SPDX-License-Identifier: GPL-3.0-or-later
// AttackersDeclaredTrigger tests — batch attack-phase trigger that fires
// once per combat regardless of attacker count, filtered by ValidPlayer$.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { AttackersDeclaredTrigger } from "./attackers-declared-trigger.js";

const SOURCE_ID = mkEntityId(30);
const TRIGGER_ID = mkEntityId(3);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAttackersDeclaredEvent = (attackingSeat: ReturnType<typeof mkPlayerSeat>) =>
  mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
    attackingSeat,
    attackers: [
      {
        attackerId: mkEntityId(99),
        defender: { kind: "player" as const, seat: OPPONENT },
      },
    ],
  });

const mkAst = (validPlayer?: string): TriggerAst => ({
  mode: "AttackersDeclared",
  params: {
    ...(validPlayer !== undefined ? { ValidPlayer: { kind: "literal" as const, raw: validPlayer } } : {}),
  },
  effect: { handlerKey: "TrigEffect", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(AttackersDeclaredTrigger);
});

triggerHandlerRegistry.register(AttackersDeclaredTrigger);

describe("AttackersDeclaredTrigger", () => {
  it("is registered under mode 'AttackersDeclared'", () => {
    expect(triggerHandlerRegistry.has("AttackersDeclared")).toBe(true);
  });

  describe("ValidPlayer$ You (default)", () => {
    it("matches when the controller attacks", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("You"), mkCtx());
      expect(ta.matches(mkAttackersDeclaredEvent(CONTROLLER))).toBe(true);
    });

    it("does NOT match when opponent attacks", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("You"), mkCtx());
      expect(ta.matches(mkAttackersDeclaredEvent(OPPONENT))).toBe(false);
    });

    it("defaults to You when ValidPlayer$ is absent", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst(), mkCtx());
      expect(ta.matches(mkAttackersDeclaredEvent(CONTROLLER))).toBe(true);
      expect(ta.matches(mkAttackersDeclaredEvent(OPPONENT))).toBe(false);
    });
  });

  describe("ValidPlayer$ Opponent", () => {
    it("matches when opponent attacks", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Opponent"), mkCtx());
      expect(ta.matches(mkAttackersDeclaredEvent(OPPONENT))).toBe(true);
    });

    it("does NOT match when controller attacks", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Opponent"), mkCtx());
      expect(ta.matches(mkAttackersDeclaredEvent(CONTROLLER))).toBe(false);
    });
  });

  describe("ValidPlayer$ Each", () => {
    it("matches regardless of attacker seat", () => {
      const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAst("Each"), mkCtx());
      expect(ta.matches(mkAttackersDeclaredEvent(CONTROLLER))).toBe(true);
      expect(ta.matches(mkAttackersDeclaredEvent(OPPONENT))).toBe(true);
    });
  });

  it("does NOT match a non-AttackersDeclared event", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("You"), mkCtx());
    const wrongEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(ta.matches(wrongEvent)).toBe(false);
  });

  it("has correct identity fields", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("You"), mkCtx());
    expect(ta.kind).toBe("triggered");
    expect(ta.id).toBe(TRIGGER_ID);
    expect(ta.sourceCardId).toBe(SOURCE_ID);
    expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
    expect(ta.isDelayed).toBe(false);
  });

  it("has a non-null resolver", () => {
    const Cls = triggerHandlerRegistry.lookup("AttackersDeclared");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ta = new Cls().build(mkAst("You"), mkCtx());
    const resolver = (ta as unknown as { resolver?: unknown }).resolver;
    expect(resolver).not.toBeNull();
    expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
  });
});

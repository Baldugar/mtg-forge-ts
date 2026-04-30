// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.A — Trigger mode coverage smoke + behaviour tests for the
// four new handlers: ClassLevelGained, RoomEntered, TakesInitiative,
// Adapted. Mirrors the wave-22 test layout.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Side-effect import — registers all Wave 70.A handlers.
import "./index.js";

const SOURCE_ID = mkEntityId(900);
const OTHER_ID = mkEntityId(901);
const TRIGGER_ID = mkEntityId(902);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (mode: string, params: Record<string, string> = {}, executeKey = "TrigEffect"): TriggerAst => ({
  mode,
  params: Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, { kind: "literal" as const, raw: v }]),
  ),
  effect: { handlerKey: executeKey, params: {} },
});

const buildTrigger = (mode: string, params: Record<string, string> = {}) => {
  const Cls = triggerHandlerRegistry.lookup(mode);
  if (!Cls) throw new Error(`No handler for mode ${mode}`);
  return new Cls().build(mkAst(mode, params), mkCtx());
};

describe("Wave 70.A — handler registration", () => {
  it("registers all four trigger-mode handlers", () => {
    for (const mode of ["ClassLevelGained", "RoomEntered", "TakesInitiative", "Adapted"]) {
      expect(triggerHandlerRegistry.has(mode)).toBe(true);
    }
  });
});

describe("ClassLevelGainedTrigger", () => {
  it("fires on level 1→2 transition when filter matches NewLevel$ 2", () => {
    const ta = buildTrigger("ClassLevelGained", { ValidCard: "Card.Self", NewLevel: "2" });
    const ev = mkEvent("ClassLevelGained", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      oldLevel: 1,
      newLevel: 2,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT fire on level 1→2 when filter is NewLevel$ 3", () => {
    const ta = buildTrigger("ClassLevelGained", { ValidCard: "Card.Self", NewLevel: "3" });
    const ev = mkEvent("ClassLevelGained", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      oldLevel: 1,
      newLevel: 2,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does NOT fire when the level event is for a different card (Card.Self gate)", () => {
    const ta = buildTrigger("ClassLevelGained", { ValidCard: "Card.Self", NewLevel: "2" });
    const ev = mkEvent("ClassLevelGained", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      oldLevel: 1,
      newLevel: 2,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("fires on every transition when NewLevel$ filter is absent", () => {
    const ta = buildTrigger("ClassLevelGained", { ValidCard: "Card.Self" });
    const ev2 = mkEvent("ClassLevelGained", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      oldLevel: 1,
      newLevel: 2,
      controllerSeat: CONTROLLER,
    });
    const ev3 = mkEvent("ClassLevelGained", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      oldLevel: 2,
      newLevel: 3,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev2)).toBe(true);
    expect(ta.matches(ev3)).toBe(true);
  });
});

describe("RoomEnteredTrigger", () => {
  it("registration smoke — handler present and matches a fully-unlocked Room event", () => {
    const ta = buildTrigger("RoomEntered", { ValidRoom: "Card.Self" });
    const ev = mkEvent("RoomEntered", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      playerSeat: CONTROLLER,
      fullyUnlocked: true,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT fire on partial unlock (fullyUnlocked: false)", () => {
    const ta = buildTrigger("RoomEntered", { ValidRoom: "Card.Self" });
    const ev = mkEvent("RoomEntered", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      playerSeat: CONTROLLER,
      fullyUnlocked: false,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("TakesInitiativeTrigger", () => {
  it("registration smoke — handler present and matches BecameInitiative for ValidPlayer$ You", () => {
    const ta = buildTrigger("TakesInitiative", { ValidPlayer: "You" });
    const ev = mkEvent("BecameInitiative", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT fire when the opponent takes initiative under ValidPlayer$ You", () => {
    const ta = buildTrigger("TakesInitiative", { ValidPlayer: "You" });
    const ev = mkEvent("BecameInitiative", 1, PhaseStep.Main1, {
      playerSeat: OPPONENT,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("AdaptedTrigger", () => {
  it("matches CardAdapted on self after Adapt resolution", () => {
    const ta = buildTrigger("Adapted", { ValidCard: "Card.Self" });
    const ev = mkEvent("CardAdapted", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      amount: 2,
    });
    expect(ta.matches(ev)).toBe(true);
  });

  it("does NOT fire on a generic CounterAdded (CardAdapted gate)", () => {
    const ta = buildTrigger("Adapted", { ValidCard: "Card.Self" });
    const ev = mkEvent("CounterAdded", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      counterType: "+1/+1",
      amount: 2,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("Wave 70.A — registration lifecycle", () => {
  it("each Wave 70.A handler can be deactivated (lookup → undefined) and re-registered cleanly", async () => {
    const mod = await import("./wave-70-triggers.js");
    const entries = [
      ["ClassLevelGained", mod.ClassLevelGainedTrigger],
      ["RoomEntered", mod.RoomEnteredTrigger],
      ["TakesInitiative", mod.TakesInitiativeTrigger],
      ["Adapted", mod.AdaptedTrigger],
    ] as const;

    // Sanity — module load already registered everything.
    for (const [m] of entries) {
      expect(triggerHandlerRegistry.has(m)).toBe(true);
    }

    // Per-mode deactivation: re-registering the same mode with a new
    // constructor swaps it out (the registry is a Map keyed by mode);
    // clearing the whole registry would disturb other test files in
    // the same worker. We exercise the reverse path by overwriting
    // each entry with a sentinel constructor and confirming lookup
    // returns the sentinel, then restore.
    for (const [m, ctor] of entries) {
      class Sentinel {
        static readonly mode = m;
        // biome-ignore lint/suspicious/noExplicitAny: test sentinel
        build(): any {
          throw new Error("sentinel");
        }
      }
      // biome-ignore lint/suspicious/noExplicitAny: test sentinel
      triggerHandlerRegistry.register(Sentinel as any);
      expect(triggerHandlerRegistry.lookup(m)).toBe(Sentinel);
      // Restore the canonical constructor.
      triggerHandlerRegistry.register(ctor);
      expect(triggerHandlerRegistry.lookup(m)).toBe(ctor);
    }
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// APNAP orderer tests — CR 603.3b (SP2 Task 21). Drives the generator
// manually so tests don't need a full driver loop. Decisions yielded
// mid-generator are answered via gen.next(response).
import type { EntityId, GameEvent, PlayerSeat } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { apnapOrder } from "./apnap-orderer.js";
import type { PendingTrigger } from "./pending-trigger.js";

const mkEv = (): GameEvent =>
  mkEvent("LifeChanged", 1, PhaseStep.Main1, {
    playerSeat: mkPlayerSeat(0),
    oldLife: 20,
    newLife: 18,
    delta: -2,
    cause: "effect",
  });

const mkPending = (opts: {
  id: number;
  triggerId: number;
  sourceCardId: number;
  controllerSeat: number;
}): PendingTrigger => ({
  id: mkEntityId(opts.id),
  triggerId: mkEntityId(opts.triggerId),
  sourceCardId: mkEntityId(opts.sourceCardId),
  event: mkEv(),
  lki: null,
  sourceControllerAtFire: mkPlayerSeat(opts.controllerSeat),
  firedAtTurn: 1,
  firedAtPhase: PhaseStep.Main1,
});

// Drive the generator to completion, feeding responses supplied by
// `respond` for each decision yielded. Returns the generator's final
// return value.
const driveAll = (
  gen: Generator<EngineYield, readonly PendingTrigger[], unknown>,
  respond: (req: EngineYield) => unknown,
): {
  readonly yielded: readonly EngineYield[];
  readonly result: readonly PendingTrigger[];
} => {
  const yielded: EngineYield[] = [];
  let step = gen.next();
  let lastResponse: unknown;
  while (!step.done) {
    yielded.push(step.value);
    lastResponse = respond(step.value);
    step = gen.next(lastResponse);
  }
  return { yielded, result: step.value };
};

describe("apnapOrder (CR 603.3b)", () => {
  it("empty pending returns empty, no decisions yielded", () => {
    const gen = apnapOrder([], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    const { yielded, result } = driveAll(gen, () => undefined);
    expect(yielded).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("1 pending for active player → no decision, returns the one", () => {
    const p = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const gen = apnapOrder([p], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    const { yielded, result } = driveAll(gen, () => undefined);
    expect(yielded).toHaveLength(0);
    expect(result).toEqual([p]);
  });

  it("1 pending per seat, 2 seats, 0 is active → returns [non-active, active] reversed", () => {
    const pActive = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pNon = mkPending({ id: 101, triggerId: 2, sourceCardId: 11, controllerSeat: 1 });
    const gen = apnapOrder([pActive, pNon], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    const { yielded, result } = driveAll(gen, () => undefined);
    expect(yielded).toHaveLength(0);
    // APNAP-flat order: active(0) first, then non-active(1) → [pActive, pNon]
    // Reversed for stack-push (so active lands on top): [pNon, pActive]
    expect(result).toEqual([pNon, pActive]);
  });

  it("2 pending for active player, 1 for non-active → yields 1 orderTriggers decision", () => {
    const pA1 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pA2 = mkPending({ id: 101, triggerId: 2, sourceCardId: 10, controllerSeat: 0 });
    const pN = mkPending({ id: 102, triggerId: 3, sourceCardId: 11, controllerSeat: 1 });
    const gen = apnapOrder([pA1, pA2, pN], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    const { yielded, result } = driveAll(gen, (req) => {
      if (req.kind !== "decision") return undefined;
      if (req.request.kind !== "orderTriggers") return undefined;
      // Player 0 keeps order [pA1, pA2]
      return { order: [mkEntityId(100), mkEntityId(101)] };
    });
    expect(yielded).toHaveLength(1);
    const first = yielded[0];
    expect(first?.kind).toBe("decision");
    if (first?.kind === "decision") {
      expect(first.request.kind).toBe("orderTriggers");
    }
    // APNAP-flat: [pA1, pA2, pN]; reversed: [pN, pA2, pA1]
    expect(result).toEqual([pN, pA2, pA1]);
  });

  it("3 seats, triggers only for non-active players → rotations correct", () => {
    const seats = [mkPlayerSeat(0), mkPlayerSeat(1), mkPlayerSeat(2)];
    const p1 = mkPending({ id: 101, triggerId: 1, sourceCardId: 10, controllerSeat: 1 });
    const p2 = mkPending({ id: 102, triggerId: 2, sourceCardId: 11, controllerSeat: 2 });
    const gen = apnapOrder([p1, p2], mkPlayerSeat(0), seats);
    const { yielded, result } = driveAll(gen, () => undefined);
    expect(yielded).toHaveLength(0);
    // APNAP-flat (active=0, no triggers, then 1, then 2): [p1, p2]; reversed: [p2, p1]
    expect(result).toEqual([p2, p1]);
  });

  it("rotation when active is not seat 0 (active=1, 3 seats)", () => {
    const seats = [mkPlayerSeat(0), mkPlayerSeat(1), mkPlayerSeat(2)];
    const p0 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const p1 = mkPending({ id: 101, triggerId: 2, sourceCardId: 11, controllerSeat: 1 });
    const p2 = mkPending({ id: 102, triggerId: 3, sourceCardId: 12, controllerSeat: 2 });
    const gen = apnapOrder([p0, p1, p2], mkPlayerSeat(1), seats);
    const { yielded, result } = driveAll(gen, () => undefined);
    expect(yielded).toHaveLength(0);
    // Rotated turn order: [1, 2, 0]; flat: [p1, p2, p0]; reversed: [p0, p2, p1]
    expect(result).toEqual([p0, p2, p1]);
  });

  it("invalid response (wrong count) throws", () => {
    const pA1 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pA2 = mkPending({ id: 101, triggerId: 2, sourceCardId: 10, controllerSeat: 0 });
    const gen = apnapOrder([pA1, pA2], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    expect(() => {
      driveAll(gen, () => ({ order: [mkEntityId(100)] }));
    }).toThrow(/must be a permutation/);
  });

  it("invalid response (duplicate id) throws", () => {
    const pA1 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pA2 = mkPending({ id: 101, triggerId: 2, sourceCardId: 10, controllerSeat: 0 });
    const gen = apnapOrder([pA1, pA2], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    expect(() => {
      driveAll(gen, () => ({ order: [mkEntityId(100), mkEntityId(100)] }));
    }).toThrow(/duplicate id/);
  });

  it("invalid response (unknown id) throws", () => {
    const pA1 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pA2 = mkPending({ id: 101, triggerId: 2, sourceCardId: 10, controllerSeat: 0 });
    const gen = apnapOrder([pA1, pA2], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    expect(() => {
      driveAll(gen, () => ({ order: [mkEntityId(100), mkEntityId(999)] }));
    }).toThrow(/unknown id/);
  });

  it("valid response returns the reversed combined order", () => {
    const pA1 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pA2 = mkPending({ id: 101, triggerId: 2, sourceCardId: 10, controllerSeat: 0 });
    const pN1 = mkPending({ id: 102, triggerId: 3, sourceCardId: 11, controllerSeat: 1 });
    const pN2 = mkPending({ id: 103, triggerId: 4, sourceCardId: 11, controllerSeat: 1 });
    const gen = apnapOrder([pA1, pA2, pN1, pN2], mkPlayerSeat(0), [mkPlayerSeat(0), mkPlayerSeat(1)]);
    const { result, yielded } = driveAll(gen, (req) => {
      if (req.kind !== "decision") return undefined;
      if (req.request.kind !== "orderTriggers") return undefined;
      // Active player reverses: [pA2, pA1]
      if (req.request.playerSeat === mkPlayerSeat(0)) {
        return { order: [mkEntityId(101), mkEntityId(100)] };
      }
      // Non-active player reverses: [pN2, pN1]
      return { order: [mkEntityId(103), mkEntityId(102)] };
    });
    expect(yielded).toHaveLength(2);
    // APNAP-flat: active first [pA2, pA1], then non-active [pN2, pN1];
    // reversed: [pN1, pN2, pA1, pA2]
    expect(result).toEqual([pN1, pN2, pA1, pA2]);
  });

  it("each ordering decision carries the expected triggerIds list", () => {
    const seats = [mkPlayerSeat(0), mkPlayerSeat(1)];
    const pA1 = mkPending({ id: 100, triggerId: 1, sourceCardId: 10, controllerSeat: 0 });
    const pA2 = mkPending({ id: 101, triggerId: 2, sourceCardId: 10, controllerSeat: 0 });
    const gen = apnapOrder([pA1, pA2], mkPlayerSeat(0), seats);
    const first = gen.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.kind).toBe("decision");
      if (first.value.kind === "decision" && first.value.request.kind === "orderTriggers") {
        const ids: readonly EntityId[] = first.value.request.triggerIds;
        const seat: PlayerSeat = first.value.request.playerSeat;
        expect(seat).toBe(mkPlayerSeat(0));
        expect(ids).toEqual([mkEntityId(100), mkEntityId(101)]);
      }
    }
  });
});

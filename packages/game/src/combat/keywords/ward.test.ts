// SPDX-License-Identifier: GPL-3.0-or-later
// Ward (CR 702.21) replacement-factory shape test. SP2 Task 49 only wires
// the factory; full behavior lands in SP3 when the cast pipeline emits a
// `targeted` MutationIntent for stepChooseTargets — see ward.ts preamble.
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { createWardReplacement } from "./ward.js";

describe("createWardReplacement (SP2 Task 49 factory)", () => {
  it("builds a ReplacementAbility with the expected shape", () => {
    const sourceCardId = mkEntityId(1);
    const id = mkEntityId(100);
    const seat = mkPlayerSeat(0);
    const repl = createWardReplacement({
      sourceCardId,
      wardAmount: 2,
      id,
      controllerSeat: seat,
    });
    expect(repl.kind).toBe("replacement");
    expect(repl.id).toBe(id);
    expect(repl.sourceCardId).toBe(sourceCardId);
    expect(repl.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(repl.isSelfReplacement).toBe(false);
    expect(repl.controllerSeatAtReg).toBe(seat);
  });
  it("defaults timestamp to 0 when not provided", () => {
    const repl = createWardReplacement({
      sourceCardId: mkEntityId(1),
      wardAmount: 1,
      id: mkEntityId(2),
      controllerSeat: mkPlayerSeat(0),
    });
    expect(repl.timestamp).toBe(0);
  });
  it("respects caller-supplied timestamp", () => {
    const repl = createWardReplacement({
      sourceCardId: mkEntityId(1),
      wardAmount: 1,
      id: mkEntityId(2),
      controllerSeat: mkPlayerSeat(0),
      timestamp: 42,
    });
    expect(repl.timestamp).toBe(42);
  });
  it("matches returns false for every intent (SP2 no-op)", () => {
    const repl = createWardReplacement({
      sourceCardId: mkEntityId(1),
      wardAmount: 2,
      id: mkEntityId(2),
      controllerSeat: mkPlayerSeat(0),
    });
    // Any shape that satisfies MutationIntent's index signature works here.
    expect(repl.matches({ kind: "damage", anything: 1 } as never)).toBe(false);
    expect(repl.matches({ kind: "moveTo", anything: 2 } as never)).toBe(false);
  });
  it("apply returns the intent unchanged (SP2 no-op)", () => {
    const repl = createWardReplacement({
      sourceCardId: mkEntityId(1),
      wardAmount: 2,
      id: mkEntityId(2),
      controllerSeat: mkPlayerSeat(0),
    });
    const intent = { kind: "damage", amount: 3 } as never;
    expect(repl.apply(intent, null)).toBe(intent);
  });
});

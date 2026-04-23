// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  type DecisionId,
  type EntityId,
  type PlayerSeat,
  mkDecisionId,
  mkEntityId,
  mkPlayerSeat,
} from "./ids.js";

describe("branded IDs", () => {
  it("constructs branded EntityId that is type-incompatible with number", () => {
    const id: EntityId = mkEntityId(42);
    expect(id as unknown as number).toBe(42);
  });
  it("branded DecisionId and EntityId are not interchangeable in types", () => {
    const eid: EntityId = mkEntityId(1);
    const did: DecisionId = mkDecisionId(1);
    expect(eid as unknown as number).toBe(did as unknown as number);
    // compile-time check: the following line would fail typecheck if uncommented.
    // const d2: DecisionId = eid;
  });
  it("PlayerSeat rejects negative values", () => {
    const seat: PlayerSeat = mkPlayerSeat(0);
    expect(seat as unknown as number).toBe(0);
    expect(() => mkPlayerSeat(-1)).toThrow();
  });
  it("EntityId rejects negative, non-integer, and NaN", () => {
    expect(() => mkEntityId(-1)).toThrow(RangeError);
    expect(() => mkEntityId(1.5)).toThrow(RangeError);
    expect(() => mkEntityId(Number.NaN)).toThrow(RangeError);
    expect(mkEntityId(0) as unknown as number).toBe(0);
  });
  it("DecisionId rejects negative, non-integer, and NaN", () => {
    expect(() => mkDecisionId(-1)).toThrow(RangeError);
    expect(() => mkDecisionId(1.5)).toThrow(RangeError);
    expect(() => mkDecisionId(Number.NaN)).toThrow(RangeError);
    expect(mkDecisionId(0) as unknown as number).toBe(0);
  });
});

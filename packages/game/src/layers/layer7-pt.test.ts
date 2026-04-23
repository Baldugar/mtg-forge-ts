// SPDX-License-Identifier: GPL-3.0-or-later
import { emptyCharacteristics } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { applyLayer7a, applyLayer7b, applyLayer7c, applyLayer7d, applyLayer7e } from "./layer7-pt.js";

describe("Layer 7a — CDA set P/T (CR 613.1g)", () => {
  it("CDA sets P/T from null baseline", () => {
    const c = emptyCharacteristics();
    applyLayer7a(c, [{ kind: "cdaSet", power: 3, toughness: 3, timestamp: 1, sourceAbilityId: null }]);
    expect(c.power).toBe(3);
    expect(c.toughness).toBe(3);
  });
});

describe("Layer 7b — set P/T", () => {
  it("set replaces any prior value", () => {
    const c = emptyCharacteristics();
    c.power = 3;
    c.toughness = 3;
    applyLayer7b(c, [{ kind: "set", power: 1, toughness: 1, timestamp: 1, sourceAbilityId: null }]);
    expect(c.power).toBe(1);
    expect(c.toughness).toBe(1);
  });
});

describe("Layer 7c — modify P/T", () => {
  it("+2/+0 on 1/1 → 3/1", () => {
    const c = emptyCharacteristics();
    c.power = 1;
    c.toughness = 1;
    applyLayer7c(c, [
      { kind: "modify", powerDelta: 2, toughnessDelta: 0, timestamp: 1, sourceAbilityId: null },
    ]);
    expect(c.power).toBe(3);
    expect(c.toughness).toBe(1);
  });

  it("modify from null baseline treats null as 0", () => {
    const c = emptyCharacteristics();
    applyLayer7c(c, [
      { kind: "modify", powerDelta: 2, toughnessDelta: 3, timestamp: 1, sourceAbilityId: null },
    ]);
    expect(c.power).toBe(2);
    expect(c.toughness).toBe(3);
  });
});

describe("Layer 7d — counters", () => {
  it("+1/+1 counters add to P/T", () => {
    const c = emptyCharacteristics();
    c.power = 1;
    c.toughness = 1;
    applyLayer7d(c, [{ kind: "plusOnePlusOne", count: 2, timestamp: 1, sourceAbilityId: null }]);
    expect(c.power).toBe(3);
    expect(c.toughness).toBe(3);
  });

  it("-1/-1 counters can drive to 0/0", () => {
    const c = emptyCharacteristics();
    c.power = 2;
    c.toughness = 2;
    applyLayer7d(c, [{ kind: "minusOneMinusOne", count: 2, timestamp: 1, sourceAbilityId: null }]);
    expect(c.power).toBe(0);
    expect(c.toughness).toBe(0);
  });

  it("ptCounter with custom ratio scales by count", () => {
    const c = emptyCharacteristics();
    c.power = 0;
    c.toughness = 0;
    applyLayer7d(c, [
      { kind: "ptCounter", powerPer: 2, toughnessPer: 0, count: 3, timestamp: 1, sourceAbilityId: null },
    ]);
    expect(c.power).toBe(6);
    expect(c.toughness).toBe(0);
  });
});

describe("Layer 7e — switch P/T", () => {
  it("switch 3/5 → 5/3", () => {
    const c = emptyCharacteristics();
    c.power = 3;
    c.toughness = 5;
    applyLayer7e(c, [{ kind: "switch", timestamp: 1, sourceAbilityId: null }]);
    expect(c.power).toBe(5);
    expect(c.toughness).toBe(3);
  });

  it("switch twice = no-op", () => {
    const c = emptyCharacteristics();
    c.power = 3;
    c.toughness = 5;
    applyLayer7e(c, [
      { kind: "switch", timestamp: 1, sourceAbilityId: null },
      { kind: "switch", timestamp: 2, sourceAbilityId: null },
    ]);
    expect(c.power).toBe(3);
    expect(c.toughness).toBe(5);
  });

  it("switch with null power/toughness yields null/null (pair swap still works)", () => {
    const c = emptyCharacteristics();
    applyLayer7e(c, [{ kind: "switch", timestamp: 1, sourceAbilityId: null }]);
    expect(c.power).toBeNull();
    expect(c.toughness).toBeNull();
  });
});

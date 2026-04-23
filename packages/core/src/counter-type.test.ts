// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { CounterType } from "./counter-type.js";

describe("CounterType", () => {
  it("has at least 60 counter types defined", () => {
    const keys = Object.keys(CounterType);
    expect(keys.length).toBeGreaterThanOrEqual(60);
  });

  it("includes canonical P/T counter types with canonical strings", () => {
    expect(CounterType.PlusOnePlusOne).toBe("+1/+1");
    expect(CounterType.MinusOneMinusOne).toBe("-1/-1");
  });

  it("includes core singleton counter types", () => {
    expect(CounterType.Loyalty).toBe("loyalty");
    expect(CounterType.Charge).toBe("charge");
    expect(CounterType.Poison).toBe("poison");
    expect(CounterType.Energy).toBe("energy");
  });

  it("all string values are unique", () => {
    const values = Object.values(CounterType);
    expect(new Set(values).size).toBe(values.length);
  });

  it("all enum identifiers are unique (no accidental duplicates)", () => {
    const keys = Object.keys(CounterType);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

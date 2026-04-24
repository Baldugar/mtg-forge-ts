// SPDX-License-Identifier: GPL-3.0-or-later
// Rampage N (CR 702.23) bonus computation — SP2 Task 50.
import { describe, expect, it } from "vitest";
import { computeRampageBonus } from "./rampage.js";

describe("computeRampageBonus (CR 702.23)", () => {
  it("0 blockers → 0 bonus", () => {
    expect(computeRampageBonus(2, 0)).toBe(0);
  });
  it("1 blocker → 0 bonus (rampage triggers only on 2+)", () => {
    expect(computeRampageBonus(2, 1)).toBe(0);
  });
  it("2 blockers → N (one extra blocker × N)", () => {
    expect(computeRampageBonus(2, 2)).toBe(2);
  });
  it("3 blockers → 2N (two extra blockers × N)", () => {
    expect(computeRampageBonus(2, 3)).toBe(4);
  });
  it("Rampage 1 with 4 blockers → 3", () => {
    expect(computeRampageBonus(1, 4)).toBe(3);
  });
  it("negative N is clamped to 0", () => {
    expect(computeRampageBonus(-1, 5)).toBe(0);
  });
});

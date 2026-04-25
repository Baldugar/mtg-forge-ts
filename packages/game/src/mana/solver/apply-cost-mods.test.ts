// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — applyCostMods solver-helper tests. Verifies generic delta folding,
// floor capping, and pass-through behaviour for empty inputs.
import { Color, ManaCost, mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { applyCostMods } from "./apply-cost-mods.js";

const mkMod = (generic: number): CostModEffect => ({
  sourceStaticId: mkEntityId(1),
  filter: () => true,
  delta: { generic },
});

describe("applyCostMods (Wave 6)", () => {
  it("returns the input cost unchanged when there are no mods", () => {
    const cost = ManaCost.parse("1 B");
    const out = applyCostMods(cost, []);
    expect(out).toBe(cost);
  });

  it("reduces a {1B} cost to {B} with generic delta -1", () => {
    const cost = ManaCost.parse("1 B");
    const out = applyCostMods(cost, [mkMod(-1)]);
    expect(out.genericCost()).toBe(0);
    // Color pip preserved.
    expect(out.colors().has(Color.Black)).toBe(true);
    expect(out.symbols.length).toBe(1);
  });

  it("raises a {1B} cost to {3B} with generic delta +2", () => {
    const cost = ManaCost.parse("1 B");
    const out = applyCostMods(cost, [mkMod(2)]);
    expect(out.genericCost()).toBe(3);
    expect(out.colors().has(Color.Black)).toBe(true);
  });

  it("floors at 0 — does not produce negative generic", () => {
    const cost = ManaCost.parse("1 B");
    const out = applyCostMods(cost, [mkMod(-5)]);
    expect(out.genericCost()).toBe(0);
    expect(out.symbols.length).toBe(1); // only the B pip remains
  });

  it("respects custom minGenericFloor", () => {
    const cost = ManaCost.parse("3");
    const out = applyCostMods(cost, [mkMod(-5)], 1);
    expect(out.genericCost()).toBe(1);
  });

  it("a B-only cost is unchanged by any reduction (no generic to remove)", () => {
    const cost = ManaCost.parse("B");
    const out = applyCostMods(cost, [mkMod(-3)]);
    expect(out.symbols.length).toBe(1);
    expect(out.colors().has(Color.Black)).toBe(true);
    expect(out.genericCost()).toBe(0);
  });

  it("sums multiple mods", () => {
    const cost = ManaCost.parse("4 B");
    const out = applyCostMods(cost, [mkMod(-1), mkMod(-2)]);
    expect(out.genericCost()).toBe(1);
  });

  it("net-zero deltas are a no-op", () => {
    const cost = ManaCost.parse("2 B");
    const out = applyCostMods(cost, [mkMod(-1), mkMod(1)]);
    expect(out).toBe(cost);
  });

  it("no-cost (hasNoCost) is returned unchanged", () => {
    const cost = ManaCost.parse("");
    expect(cost.isNoCost()).toBe(true);
    const out = applyCostMods(cost, [mkMod(-2)]);
    expect(out).toBe(cost);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { Color, ManaCost, ManaProduced } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { ManaPool } from "../mana-pool.js";
import { solveManaPayment } from "./solver.js";

/** Build a pool from an array of ManaProduced entries. */
function makePool(entries: ManaProduced[]): ManaPool {
  const pool = new ManaPool();
  for (const e of entries) pool.add(e);
  return pool;
}

describe("solveManaPayment", () => {
  it("pays 'R' from pool of [R]", () => {
    const cost = ManaCost.parse("R");
    const pool = makePool([ManaProduced.colored(Color.Red)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(1);
    expect(plan?.consumed[0]?.symbol.color).toBe(Color.Red);
    expect(plan?.consumed[0]?.poolIndex).toBe(0);
    expect(plan?.lifePaid).toBe(0);
  });

  it("pays 'R' from pool of [G] → null", () => {
    const cost = ManaCost.parse("R");
    const pool = makePool([ManaProduced.colored(Color.Green)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).toBeNull();
  });

  it("pays '1R' from pool of [R, G] → uses R for colored, G for generic", () => {
    // Solver sorts: colored{Red} pip first, generic{1} pip second.
    // Pool: [Red@0, Green@1]. Colored pip matches Red@0. Generic pip matches Green@1.
    const cost = ManaCost.parse("1R");
    const pool = makePool([ManaProduced.colored(Color.Red), ManaProduced.colored(Color.Green)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(2);
    // colored pip consumed Red (index 0), generic pip consumed Green (index 1)
    const redConsumed = plan?.consumed.find((c) => c.symbol.color === Color.Red);
    const greenConsumed = plan?.consumed.find((c) => c.symbol.color === Color.Green);
    expect(redConsumed).toBeDefined();
    expect(greenConsumed).toBeDefined();
    expect(redConsumed?.poolIndex).toBe(0);
    expect(greenConsumed?.poolIndex).toBe(1);
    expect(plan?.lifePaid).toBe(0);
  });

  it("pays 'W/U' from pool of [U] → uses U", () => {
    const cost = ManaCost.parse("W/U");
    const pool = makePool([ManaProduced.colored(Color.Blue)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(1);
    expect(plan?.consumed[0]?.symbol.color).toBe(Color.Blue);
  });

  it("pays 'W/P' (phyrexian) from empty pool → plan.lifePaid=2", () => {
    const cost = ManaCost.parse("W/P");
    const pool = makePool([]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(0);
    expect(plan?.lifePaid).toBe(2);
  });

  it("pays 'W/P' from pool of [W] → uses W, no life", () => {
    const cost = ManaCost.parse("W/P");
    const pool = makePool([ManaProduced.colored(Color.White)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(1);
    expect(plan?.lifePaid).toBe(0);
  });

  it("pays 'XR' with xValue=2 from pool of [R, G, G, G] → uses R for colored, 2G for X", () => {
    // Symbols: [variable{X}, colored{Red}]. With xValue=2, expanded to
    // [generic{1}, generic{1}, colored{Red}].
    // Sorted: colored{Red} first, then generic, generic.
    const cost = ManaCost.parse("XR");
    const pool = makePool([
      ManaProduced.colored(Color.Red),
      ManaProduced.colored(Color.Green),
      ManaProduced.colored(Color.Green),
      ManaProduced.colored(Color.Green),
    ]);
    const plan = solveManaPayment(cost, pool, { xValue: 2 });
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(3); // 1 colored + 2 generic (X=2)
    expect(plan?.xValue).toBe(2);
    // The Red entry (index 0) should be in consumed for the colored pip.
    const redConsumed = plan?.consumed.find((c) => c.symbol.color === Color.Red);
    expect(redConsumed).toBeDefined();
    expect(plan?.lifePaid).toBe(0);
  });

  it("pays '2' from pool of [R] → null (not enough)", () => {
    const cost = ManaCost.parse("2");
    const pool = makePool([ManaProduced.colored(Color.Red)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).toBeNull();
  });

  it("pays '0' from any pool → trivially paid", () => {
    const cost = ManaCost.parse("0");
    const pool = makePool([]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    expect(plan?.consumed).toHaveLength(0);
    expect(plan?.lifePaid).toBe(0);
  });

  it("does not use a colored pool entry for a generic pip when a specific pip needs it", () => {
    // "1R" with pool [R, B]. Solver must use R for colored{Red}, B for generic.
    // NOT use R for generic and fail to pay colored{Red}.
    const cost = ManaCost.parse("1R");
    const pool = makePool([ManaProduced.colored(Color.Red), ManaProduced.colored(Color.Black)]);
    const plan = solveManaPayment(cost, pool);
    expect(plan).not.toBeNull();
    const redConsumed = plan?.consumed.find((c) => c.symbol.color === Color.Red);
    expect(redConsumed).toBeDefined(); // R was used for the colored pip
  });

  it("colorless pip requires colorless (null-color) mana", () => {
    const cost = ManaCost.parse("C");
    const poolColored = makePool([ManaProduced.colored(Color.Red)]);
    expect(solveManaPayment(cost, poolColored)).toBeNull();

    const poolColorless = makePool([ManaProduced.colorless()]);
    const plan = solveManaPayment(cost, poolColorless);
    expect(plan).not.toBeNull();
  });

  it("snow pip requires snow mana", () => {
    const cost = ManaCost.parse("S");
    const poolNonSnow = makePool([ManaProduced.colored(Color.Red)]);
    expect(solveManaPayment(cost, poolNonSnow)).toBeNull();

    const poolSnow = makePool([ManaProduced.snow(Color.Green)]);
    const plan = solveManaPayment(cost, poolSnow);
    expect(plan).not.toBeNull();
  });
});

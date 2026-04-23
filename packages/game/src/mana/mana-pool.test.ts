// SPDX-License-Identifier: GPL-3.0-or-later
import { Color, Cost, ManaProduced, mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { ManaPool } from "./mana-pool.js";

const red = (): ManaProduced => ManaProduced.colored(Color.Red, { sourceId: mkEntityId(1) });
const blue = (): ManaProduced => ManaProduced.colored(Color.Blue, { sourceId: mkEntityId(2) });
const colorless = (): ManaProduced => ManaProduced.colorless({ sourceId: mkEntityId(3) });

describe("ManaPool", () => {
  it("is empty on construction", () => {
    const pool = new ManaPool();
    expect(pool.size()).toBe(0);
    expect(pool.toArray()).toEqual([]);
  });

  it("add increases size", () => {
    const pool = new ManaPool();
    pool.add(red());
    expect(pool.size()).toBe(1);
    expect(pool.toArray()).toHaveLength(1);
    expect(pool.toArray()[0]?.color).toBe(Color.Red);
  });

  it("add preserves insertion order", () => {
    const pool = new ManaPool();
    pool.add(red());
    pool.add(blue());
    pool.add(colorless());
    const out = pool.toArray();
    expect(out).toHaveLength(3);
    expect(out[0]?.color).toBe(Color.Red);
    expect(out[1]?.color).toBe(Color.Blue);
    expect(out[2]?.color).toBeNull();
  });

  it("empty clears all shards", () => {
    const pool = new ManaPool();
    pool.add(red());
    pool.add(blue());
    pool.empty();
    expect(pool.size()).toBe(0);
    expect(pool.toArray()).toEqual([]);
  });

  it("snapshot + restore round-trips pool state", () => {
    const pool = new ManaPool();
    pool.add(red());
    pool.add(blue());
    const snap = pool.snapshot();
    pool.add(colorless());
    pool.add(colorless());
    expect(pool.size()).toBe(4);
    pool.restore(snap);
    expect(pool.size()).toBe(snap.length);
    expect(pool.size()).toBe(2);
    expect(pool.toArray()[0]?.color).toBe(Color.Red);
    expect(pool.toArray()[1]?.color).toBe(Color.Blue);
  });

  it("snapshot returns an independent array (mutation doesn't affect pool)", () => {
    const pool = new ManaPool();
    pool.add(red());
    const snap = pool.snapshot();
    snap.length = 0;
    expect(pool.size()).toBe(1);
  });

  it("toArray returns an independent array", () => {
    const pool = new ManaPool();
    pool.add(red());
    const arr = pool.toArray();
    arr.length = 0;
    expect(pool.size()).toBe(1);
  });

  it("restore takes a readonly snapshot and seats it as the new state", () => {
    const pool = new ManaPool();
    pool.add(red());
    pool.restore([blue(), colorless()]);
    expect(pool.size()).toBe(2);
    expect(pool.toArray()[0]?.color).toBe(Color.Blue);
    expect(pool.toArray()[1]?.color).toBeNull();
  });

  it("toJSON serializes shards via each ManaProduced.toJSON", () => {
    const pool = new ManaPool();
    pool.add(red());
    pool.add(colorless());
    const json = pool.toJSON();
    expect(json.shards).toHaveLength(2);
    expect(json.shards[0]?.color).toBe(Color.Red);
    expect(json.shards[1]?.color).toBeNull();
  });

  it("canPay throws with SP3 required message", () => {
    const pool = new ManaPool();
    expect(() => pool.canPay(Cost.of())).toThrow(/SP3/);
  });

  it("removeForPayment throws with SP3 required message", () => {
    const pool = new ManaPool();
    expect(() => pool.removeForPayment(Cost.of())).toThrow(/SP3/);
  });
});

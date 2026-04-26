// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 baseline + Wave 11 completeness — applyCostMods solver-helper tests.
// Verifies generic delta folding, MinMana$ floor stacking, dynamic Amount$
// closures, Cost$-form colored add/subtract, and SetCost setMinTotal.
import { Color, ManaCost, mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";
import { applyCostMods } from "./apply-cost-mods.js";

const mkMod = (generic: number): CostModEffect => ({
  sourceStaticId: mkEntityId(1),
  filter: () => true,
  delta: { generic },
});

describe("applyCostMods (Wave 6 baseline)", () => {
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

describe("applyCostMods — Wave 11: MinMana$ floor (Gap 1)", () => {
  it("floors generic at MinMana$=1 — Zirda: -2 reduction on {2}{B} produces {1}{B}", () => {
    const cost = ManaCost.parse("2 B");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: -2 },
      minMana: 1,
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.genericCost()).toBe(1);
    expect(out.colors().has(Color.Black)).toBe(true);
  });

  it("MinMana$=1 still allows a -1 reduction on {2} → {1}", () => {
    const cost = ManaCost.parse("2");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: -1 },
      minMana: 1,
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.genericCost()).toBe(1);
  });

  it("stacking mods: max(MinMana) wins (most restrictive). One MinMana=1 + one MinMana=2 → floor=2", () => {
    const cost = ManaCost.parse("3 B");
    const a: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: -2 },
      minMana: 1,
    };
    const b: CostModEffect = {
      sourceStaticId: mkEntityId(2),
      filter: () => true,
      delta: { generic: -2 },
      minMana: 2,
    };
    const out = applyCostMods(cost, [a, b]);
    // -4 total reduction on {3} would underflow; floor is max(1,2)=2.
    expect(out.genericCost()).toBe(2);
  });
});

describe("applyCostMods — Wave 11: dynamic generic delta (Gap 6)", () => {
  it("evaluates a function delta.generic against game/item context", () => {
    const cost = ManaCost.parse("4");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: () => -3 },
    };
    const out = applyCostMods(cost, [mod], { item: {}, game: {} as never });
    expect(out.genericCost()).toBe(1);
  });

  it("function delta receives item and game", () => {
    const cost = ManaCost.parse("5");
    const captured: { item?: unknown; game?: unknown } = {};
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: {
        generic: (item, game) => {
          captured.item = item;
          captured.game = game;
          return -2;
        },
      },
    };
    const out = applyCostMods(cost, [mod], { item: { tag: "x" }, game: { id: 7 } as never });
    expect(out.genericCost()).toBe(3);
    expect(captured.item).toEqual({ tag: "x" });
    expect(captured.game).toEqual({ id: 7 });
  });
});

describe("applyCostMods — Wave 11: Cost$ colored raise/reduce (Gap 4)", () => {
  it("addSymbols raises a {1}{W} cost by {W} → {1}{W}{W}", () => {
    const cost = ManaCost.parse("1 W");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { addSymbols: [{ kind: "colored", color: Color.White }] },
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.genericCost()).toBe(1);
    // Two white pips now present.
    let whiteCount = 0;
    for (const s of out.symbols) {
      if (s.kind === "colored" && s.color === Color.White) whiteCount++;
    }
    expect(whiteCount).toBe(2);
  });

  it("subtractSymbols removes a {W} from {2}{W}{W} → {2}{W}", () => {
    const cost = ManaCost.parse("2 W W");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { subtractSymbols: [{ kind: "colored", color: Color.White }] },
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.genericCost()).toBe(2);
    let whiteCount = 0;
    for (const s of out.symbols) {
      if (s.kind === "colored" && s.color === Color.White) whiteCount++;
    }
    expect(whiteCount).toBe(1);
  });

  it("subtractSymbols is a silent no-op when the pip is absent", () => {
    const cost = ManaCost.parse("1 R");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { subtractSymbols: [{ kind: "colored", color: Color.White }] },
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.genericCost()).toBe(1);
    expect(out.colors().has(Color.Red)).toBe(true);
  });
});

describe("applyCostMods — Wave 11: SetCost setMinTotal (Gap 5)", () => {
  it("Trinisphere: {1}{B} → {2}{B} (top up to mana value 3)", () => {
    const cost = ManaCost.parse("1 B");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: {},
      setMinTotal: 3,
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.cmc()).toBe(3);
    expect(out.genericCost()).toBe(2);
    expect(out.colors().has(Color.Black)).toBe(true);
  });

  it("SetCost is a no-op when base cost already meets the floor", () => {
    const cost = ManaCost.parse("2 W W");
    const mod: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: {},
      setMinTotal: 3,
    };
    const out = applyCostMods(cost, [mod]);
    expect(out.cmc()).toBe(4);
    expect(out.genericCost()).toBe(2);
  });

  it("SetCost stacking: max(setMinTotal) wins", () => {
    const cost = ManaCost.parse("R");
    const a: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: {},
      setMinTotal: 2,
    };
    const b: CostModEffect = {
      sourceStaticId: mkEntityId(2),
      filter: () => true,
      delta: {},
      setMinTotal: 4,
    };
    const out = applyCostMods(cost, [a, b]);
    expect(out.cmc()).toBe(4);
    expect(out.genericCost()).toBe(3);
  });
});

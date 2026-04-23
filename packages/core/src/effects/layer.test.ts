// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { LAYER_ORDER, Layer } from "./layer.js";

describe("Layer enum", () => {
  it("has 11 entries (1,2,3,4,5,6,7a,7b,7c,7d,7e)", () => {
    expect(Object.values(Layer).filter((v) => typeof v === "number")).toHaveLength(11);
  });
  it("LAYER_ORDER runs 1 → 2 → 3 → 4 → 5 → 6 → 7a → 7b → 7c → 7d → 7e", () => {
    expect(LAYER_ORDER).toEqual([
      Layer.L1_Copy,
      Layer.L2_Control,
      Layer.L3_Text,
      Layer.L4_Type,
      Layer.L5_Color,
      Layer.L6_Ability,
      Layer.L7a_PTCda,
      Layer.L7b_PTSet,
      Layer.L7c_PTModify,
      Layer.L7d_PTCounter,
      Layer.L7e_PTSwitch,
    ]);
  });
  it("LAYER_ORDER is strictly ascending by numeric value (sort-trivial invariant)", () => {
    // WHY: layer.ts comment promises LAYER_ORDER.sort() is trivial because
    // values encode order (1..6, 71..75). Guard against someone changing the
    // enum values and silently breaking a LayerEngine that relies on sort-by-
    // value instead of the explicit array.
    for (let i = 1; i < LAYER_ORDER.length; i++) {
      const prev = LAYER_ORDER[i - 1];
      const curr = LAYER_ORDER[i];
      if (prev === undefined || curr === undefined) {
        throw new Error("LAYER_ORDER has holes");
      }
      expect(curr).toBeGreaterThan(prev);
    }
  });
});

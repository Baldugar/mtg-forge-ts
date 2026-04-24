// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { REPLACEMENT_LAYERS, type ReplacementLayer, replacementLayerOrder } from "./replacement-layer.js";

describe("ReplacementLayer", () => {
  it("enumerates the five CR 616.1 layers in canonical order", () => {
    expect(REPLACEMENT_LAYERS).toEqual(["cantHappen", "control", "copy", "transform", "other"]);
  });

  it("assigns strictly ascending integer ranks", () => {
    const ranks = REPLACEMENT_LAYERS.map(replacementLayerOrder);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });

  it("comparator puts cantHappen before other", () => {
    const cmp = (a: ReplacementLayer, b: ReplacementLayer) =>
      replacementLayerOrder(a) - replacementLayerOrder(b);
    const layers: ReplacementLayer[] = ["other", "cantHappen", "control", "transform", "copy"];
    layers.sort(cmp);
    expect(layers).toEqual(["cantHappen", "control", "copy", "transform", "other"]);
  });
});

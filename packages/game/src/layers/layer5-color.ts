// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1e — Layer 5 color-changing effects. Within the layer, CDAs
// (characteristic-defining abilities, CR 604.3) apply first; non-CDA
// effects apply after, each partition sorted by timestamp.
//
// Kinds:
//   - "set":    replace the color set entirely.
//   - "add":    union colors into the current set.
//   - "remove": strip the given color bits from the current set.
//
// `remove` uses bit math via ColorSet.toJSON + fromJSON since ColorSet
// has no public complement/difference method. All three methods are
// idempotent on empty inputs.
//
// Forge reference: StaticAbilityContinuous (setColor / addColor).
import type { Characteristics, EntityId } from "@mtg-forge-ts/core";
import { ColorSet } from "@mtg-forge-ts/core";

export type ColorChangeEffect =
  | {
      readonly kind: "set";
      readonly colors: ColorSet;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "add";
      readonly colors: ColorSet;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "remove";
      readonly colors: ColorSet;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    };

const subtract = (a: ColorSet, b: ColorSet): ColorSet => ColorSet.fromJSON(a.toJSON() & ~b.toJSON());

export const applyLayer5Color = (target: Characteristics, effects: readonly ColorChangeEffect[]): void => {
  const cdas = effects.filter((e) => e.isCda).sort((a, b) => a.timestamp - b.timestamp);
  const normals = effects.filter((e) => !e.isCda).sort((a, b) => a.timestamp - b.timestamp);
  for (const e of [...cdas, ...normals]) {
    switch (e.kind) {
      case "set":
        target.colors = e.colors;
        break;
      case "add":
        target.colors = target.colors.union(e.colors);
        break;
      case "remove":
        target.colors = subtract(target.colors, e.colors);
        break;
      default: {
        const _: never = e;
        throw new Error(`applyLayer5Color: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
};

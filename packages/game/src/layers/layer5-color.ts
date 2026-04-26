// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1e — Layer 5 color-changing effects. Within the layer, CDAs
// (characteristic-defining abilities, CR 604.3) apply first; non-CDA
// effects apply after. Within each partition, effects resolve in
// dependency-then-timestamp order (CR 613.8).
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
import { type DepNode, resolveDependencyOrder } from "./dependency-resolver.js";

// Wave 47 — Layer 5 carries optional per-card scoping. See Layer 4 doc-comment.
export type ColorChangeEffect =
  | {
      readonly kind: "set";
      readonly colors: ColorSet;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "add";
      readonly colors: ColorSet;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "remove";
      readonly colors: ColorSet;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    };

const subtract = (a: ColorSet, b: ColorSet): ColorSet => ColorSet.fromJSON(a.toJSON() & ~b.toJSON());

const nodeId = (e: { readonly sourceAbilityId: EntityId | null }, idx: number): string =>
  e.sourceAbilityId !== null ? String(e.sourceAbilityId) : `__anon_${idx}`;

const toDepNodes = <
  T extends {
    readonly timestamp: number;
    readonly sourceAbilityId: EntityId | null;
    readonly dependsOn?: readonly string[];
  },
>(
  effects: readonly T[],
): DepNode<T>[] =>
  effects.map((e, i) => ({
    id: nodeId(e, i),
    timestamp: e.timestamp,
    dependsOn: e.dependsOn ?? [],
    raw: e,
  }));

export const applyLayer5Color = (
  target: Characteristics,
  effects: readonly ColorChangeEffect[],
  targetCardId?: EntityId | null,
): void => {
  // Wave 47 — per-card scoping for `Affected$ <filter>` continuous statics.
  const scoped =
    targetCardId === undefined || targetCardId === null
      ? effects
      : effects.filter((e) => e.appliesToCardIdFn === undefined || e.appliesToCardIdFn(targetCardId));
  const cdas = toDepNodes(scoped.filter((e) => e.isCda));
  const normals = toDepNodes(scoped.filter((e) => !e.isCda));
  const ordered: ColorChangeEffect[] = [
    ...resolveDependencyOrder(cdas).map((n) => n.raw as ColorChangeEffect),
    ...resolveDependencyOrder(normals).map((n) => n.raw as ColorChangeEffect),
  ];
  for (const e of ordered) {
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

// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1d — Layer 4 type-changing effects. Within the layer, CDAs
// (characteristic-defining abilities, CR 604.3) apply first; non-CDA
// effects apply after. Within each CDA/non-CDA partition, effects resolve
// in dependency-then-timestamp order (CR 613.8) via resolveDependencyOrder.
//
// `dependsOn` carries sourceAbilityId strings that this effect depends on
// — the resolver applies prerequisites first. SP2 effects without explicit
// dependencies fall through to timestamp ordering naturally.
//
// Kinds:
//   - "add":     add a CardType to the type set.
//   - "remove":  remove a CardType if present.
//   - "becomes": replace the type set entirely.
//
// Forge reference: StaticAbilityContinuous (addType / removeType / setType).
import type { CardType, Characteristics, EntityId } from "@mtg-forge-ts/core";
import { type DepNode, resolveDependencyOrder } from "./dependency-resolver.js";

export type TypeChangeEffect =
  | {
      readonly kind: "add";
      readonly cardType: CardType;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
    }
  | {
      readonly kind: "remove";
      readonly cardType: CardType;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
    }
  | {
      readonly kind: "becomes";
      readonly types: ReadonlySet<CardType>;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
    };

// WHY: Each applier passes effects through the CR 613.8 dependency resolver
// before applying. SP2 effects carry `sourceAbilityId` (nullable); we use
// its string form as the node id, with a per-index fallback for nulls so
// no two nodes share an id. Without explicit dependsOn the resolver
// degenerates to stable timestamp sort — matching the pre-SP2 behavior.
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

export const applyLayer4Type = (target: Characteristics, effects: readonly TypeChangeEffect[]): void => {
  // CR 613.1d keeps CDAs ahead of non-CDAs — the dependency resolver runs
  // within each partition.
  const cdas = toDepNodes(effects.filter((e) => e.isCda));
  const normals = toDepNodes(effects.filter((e) => !e.isCda));
  const ordered: TypeChangeEffect[] = [
    ...resolveDependencyOrder(cdas).map((n) => n.raw as TypeChangeEffect),
    ...resolveDependencyOrder(normals).map((n) => n.raw as TypeChangeEffect),
  ];
  for (const e of ordered) {
    switch (e.kind) {
      case "add":
        target.types.add(e.cardType);
        break;
      case "remove":
        target.types.delete(e.cardType);
        break;
      case "becomes":
        target.types.clear();
        for (const t of e.types) target.types.add(t);
        break;
      default: {
        const _: never = e;
        throw new Error(`applyLayer4Type: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
};

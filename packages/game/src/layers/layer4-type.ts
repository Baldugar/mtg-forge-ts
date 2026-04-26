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

// Wave 47 — Layer 4 carries optional per-card scoping so Continuous statics
// like `Affected$ Card.YouCtrl | AddType$ Goblin` apply only to the
// matching cards rather than every card in the game. Effects without an
// `appliesToCardIdFn` remain global (the SP2 baseline). Wave 47 also
// introduces an "addSubtype"/"removeSubtype" pair for AddSubType$/
// RemoveSubType$ payloads (Conspiracy "becomes a Goblin" etc) and a
// "removeAllCardTypes" for `RemoveCardTypes$ True`.
export type TypeChangeEffect =
  | {
      readonly kind: "add";
      readonly cardType: CardType;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "remove";
      readonly cardType: CardType;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "becomes";
      readonly types: ReadonlySet<CardType>;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "addSubtype";
      readonly subtype: string;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "removeSubtype";
      readonly subtype: string;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "removeAllCardTypes";
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
    }
  | {
      readonly kind: "removeAllCreatureTypes";
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
      readonly dependsOn?: readonly string[];
      readonly appliesToCardIdFn?: (cardId: EntityId) => boolean;
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

export const applyLayer4Type = (
  target: Characteristics,
  effects: readonly TypeChangeEffect[],
  targetCardId?: EntityId | null,
): void => {
  // Wave 47 — Layer 4 effects may carry an `appliesToCardIdFn` predicate
  // that scopes application to a subset of cards (e.g. Conspiracy:
  // `Affected$ Creature.YouCtrl`). Effects without the predicate remain
  // global (the SP2 baseline). Single-target Continuous statics use
  // appliesToCardIdFn(id) === id checks rather than the older 7c-style
  // function-shape because Layer 4's apply path takes the card id as an
  // argument.
  const scoped =
    targetCardId === undefined || targetCardId === null
      ? effects
      : effects.filter((e) => e.appliesToCardIdFn === undefined || e.appliesToCardIdFn(targetCardId));
  // CR 613.1d keeps CDAs ahead of non-CDAs — the dependency resolver runs
  // within each partition.
  const cdas = toDepNodes(scoped.filter((e) => e.isCda));
  const normals = toDepNodes(scoped.filter((e) => !e.isCda));
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
      case "addSubtype":
        target.subtypes.add(e.subtype);
        break;
      case "removeSubtype":
        target.subtypes.delete(e.subtype);
        break;
      case "removeAllCardTypes":
        target.types.clear();
        break;
      case "removeAllCreatureTypes":
        // CR 205.3 — creature subtypes are the subtypes of cards with
        // CardType.Creature. We don't have a curated creature-subtype
        // registry at runtime, so the closest practical interpretation is
        // to clear all subtypes (Conspiracy / Painter's Servant patterns
        // expect this so the chosen type is the only subtype). Card-type
        // supertypes (Legendary etc.) live in chars.supertypes and are
        // left untouched.
        target.subtypes.clear();
        break;
      default: {
        const _: never = e;
        throw new Error(`applyLayer4Type: unreachable ${JSON.stringify(_)}`);
      }
    }
  }
};

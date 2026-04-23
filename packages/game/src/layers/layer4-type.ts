// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1d — Layer 4 type-changing effects. Within the layer, CDAs
// (characteristic-defining abilities, CR 604.3) apply first; non-CDA
// effects apply after, each partition sorted by timestamp.
//
// Kinds:
//   - "add":     add a CardType to the type set.
//   - "remove":  remove a CardType if present.
//   - "becomes": replace the type set entirely.
//
// Forge reference: StaticAbilityContinuous (addType / removeType / setType).
import type { CardType, Characteristics, EntityId } from "@mtg-forge-ts/core";

export type TypeChangeEffect =
  | {
      readonly kind: "add";
      readonly cardType: CardType;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "remove";
      readonly cardType: CardType;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "becomes";
      readonly types: ReadonlySet<CardType>;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    };

export const applyLayer4Type = (target: Characteristics, effects: readonly TypeChangeEffect[]): void => {
  const cdas = effects.filter((e) => e.isCda).sort((a, b) => a.timestamp - b.timestamp);
  const normals = effects.filter((e) => !e.isCda).sort((a, b) => a.timestamp - b.timestamp);
  for (const e of [...cdas, ...normals]) {
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

// SPDX-License-Identifier: GPL-3.0-or-later
// Characteristics = the fully-layered runtime view of a Card's rules-relevant
// state. @mtg-forge-ts/game's LayerEngine computes this by starting from a
// base derived from PaperCard.definition and walking LAYER_ORDER.
//
// Intentionally mutable: layers modify in place while walking. LayerEngine's
// cache wraps the returned value; freezing would force per-layer copies.
//
// `subtypes` uses `string` because MTG subtypes are free-form (printed as the
// text after the em-dash on the type line) and the SP1 port already carries
// them as `readonly string[]` on `TypeLine` (packages/core/src/card/types.ts).
// There is no `Subtype` enum in the codebase.
import type { CardType, Supertype } from "../card/index.js";
import { ColorSet } from "../color.js";
import type { EntityId } from "../ids.js";
import { ManaCost } from "../mana/index.js";

// SP2 scope: abilities stores refs (ids pointing into the registries). SP3
// attaches full ability bodies. This type stays stable across SPs.
export interface ActiveAbilityRef {
  readonly id: EntityId;
  readonly grantedBy: EntityId | null; // null = intrinsic
  readonly origin: "intrinsic" | "layer6" | "aura" | "copy";
}

export interface Characteristics {
  name: string;
  manaCost: ManaCost;
  colorIndicator: ColorSet | null;
  supertypes: Set<Supertype>;
  types: Set<CardType>;
  subtypes: Set<string>;
  colors: ColorSet;
  rulesText: string;
  power: number | null;
  toughness: number | null;
  loyalty: number | null;
  defense: number | null;
  abilities: ActiveAbilityRef[];
}

/**
 * Build a fresh, mutable baseline Characteristics. Every call returns its own
 * Set / array instances so LayerEngine can safely mutate-in-place while
 * walking LAYER_ORDER.
 *
 * The baseline mana cost uses `ManaCost.parse("")` which yields Forge's
 * NO_COST (zero symbols, `hasNoCost=true`). SP2's base-characteristics
 * builder overrides this with the PaperCard's printed cost before any
 * layers fire.
 */
export const emptyCharacteristics = (): Characteristics => ({
  name: "",
  manaCost: ManaCost.parse(""),
  colorIndicator: null,
  supertypes: new Set(),
  types: new Set(),
  subtypes: new Set(),
  colors: ColorSet.empty(),
  rulesText: "",
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  abilities: [],
});

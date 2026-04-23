// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613 layer enumeration. LAYER_ORDER is the canonical traversal order
// used by @mtg-forge-ts/game's LayerEngine when computing Characteristics.
//
// Forge mapping: forge.game.staticability.StaticAbilityLayer enum. We keep
// these numeric so the snapshot layer stores integers and LAYER_ORDER.sort()
// is trivial. Layers 7a-7e get ids 71-75 to preserve ordering by value.
//
// Relation to the SP1 `ContinuousEffect.layer: number` field: that field is
// coarse (1-7) and serves as an opaque pass-through on SP1's snapshot. SP2
// stores the fine-grained Layer enum value directly on `LayerEffect` (below),
// which is the new shape the LayerEngine consumes. ContinuousEffect stays as
// a serialization-compat placeholder until it is migrated/replaced in SP2.
import type { EntityId } from "../ids.js";

export enum Layer {
  L1_Copy = 1,
  L2_Control = 2,
  L3_Text = 3,
  L4_Type = 4,
  L5_Color = 5,
  L6_Ability = 6,
  L7a_PTCda = 71,
  L7b_PTSet = 72,
  L7c_PTModify = 73,
  L7d_PTCounter = 74,
  L7e_PTSwitch = 75,
}

export const LAYER_ORDER: readonly Layer[] = [
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
];

// Marker interface — per-layer effect subtypes extend this with their own
// payload. LayerEngine (in @mtg-forge-ts/game) applies by dispatching on
// `.layer`.
export interface LayerEffect {
  readonly layer: Layer;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
}

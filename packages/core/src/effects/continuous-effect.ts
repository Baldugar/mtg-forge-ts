// SPDX-License-Identifier: GPL-3.0-or-later
// ContinuousEffect — SP2-populated shape placeholder. Master spec §2 lists
// `continuousEffects: ContinuousEffect[]` as part of the Game state model.
// SP1 reserves the interface so Game.continuousEffects and GameSnapshot can
// carry the list through schema bumps without requiring another breaking
// version bump once SP2 (CR 613 layer system) lands.
//
// SP1 stores whatever SP2 produces, round-trips through snapshot losslessly,
// and exposes no behavior. SP2 fills in the discriminated `kind`, the
// `payload` structure per-family, and adds the layer-application engine
// that consumes these records.
//
// Why a bare interface with `unknown` payload? The layer system's effect
// library is large (flavor-text, characteristic-setting, power/toughness
// swap, …). Shipping a typed union now would lock SP2 into names and
// shapes it should be free to discover. The `kind` string is opaque in
// SP1; restore accepts any value and SP2's consumers narrow as needed.
import type { EntityId } from "../ids.js";

export interface ContinuousEffect {
  /** Engine-assigned unique id so dependencies / removal can reference it. */
  readonly id: EntityId;
  /** Source permanent / emblem generating the effect. */
  readonly sourceId: EntityId;
  /** CR 613 layer (1-7). SP2 validates the range; SP1 stores verbatim. */
  readonly layer: number;
  /** Sub-layer for Layer 6 dependency + Layer 7 a/b/c/d sub-ordering. */
  readonly sublayer: number;
  /** Creation-time ordinal for same-layer ordering (lowest first). */
  readonly timestamp: number;
  /** Effect family identifier populated by SP2 (e.g. "typeChange", "ptSwap"). */
  readonly kind: string;
  /** Family-specific parameters. SP2 defines the per-kind shapes. */
  readonly payload: unknown;
}

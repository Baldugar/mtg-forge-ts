// SPDX-License-Identifier: GPL-3.0-or-later
// Internal cast-pipeline context, accumulated across the 10 steps of CR 601.2.
// Each step mutates this; the final step builds a StackItem from it.
//
// Tasks 36-39 populate fields as steps execute; Task 39 uses this snapshot
// to reverse on abort (e.g., refund partial mana payments + re-tap lands
// that were untapped as part of an aborted cast).
import type { EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import type { StackItemProvenance } from "./stack-item-provenance.js";

export interface CastContext {
  readonly castingPlayer: PlayerSeat;
  readonly sourceCardId: EntityId;
  readonly originZone: ZoneType;
  /**
   * True when the cast is a special action (e.g. turning a manifested
   * permanent face up by paying its mana cost — CR 701.33). Special
   * actions bypass priority and several cast steps; keeping the flag on
   * the context lets steps 5-10 branch without re-deriving.
   */
  readonly asSpecialAction: boolean;
  // Fields populated across steps. Non-readonly: every step mutates the
  // context it owns, while the three fields above are cast-constant.
  faceChosen: StackItemProvenance["faceChosen"] | undefined;
  alternativeZoneDestination: ZoneType | undefined;
  altCostUsed: string | null;
  additionalCostsPaid: string[];
  modesChosen: string[];
  xValue: number | undefined;
  // WHY: parallel-array shape matches the DecisionRequest/distribute response
  // payload (index → amount). Populated in step 6 (DistributeX) — SP3 wires
  // the full divide-damage/counters effect surface.
  distributions: Record<number, number> | undefined;
  // WHY `unknown`: TargetChoices ships from ../target/restriction.ts; importing
  // it here would create a cycle target → game → cast → target. Step 7
  // casts through unknown at the TargetSystem boundary.
  targets: readonly unknown[] | undefined;
  // WHY `unknown`: ManaCost / total-cost AST lands in SP3. Step 8 stores
  // the computed cost as an opaque handle; step 10 consumes it.
  totalCost: unknown | undefined;
  // Ordered list of per-cost payment receipts. Step 9 (ActivateManaAbilities)
  // and step 10 (PayCosts) append; abort (Task 39) unwinds in reverse.
  paidAlready: unknown[];
}

export const createCastContext = (params: {
  castingPlayer: PlayerSeat;
  sourceCardId: EntityId;
  originZone: ZoneType;
  asSpecialAction: boolean;
}): CastContext => ({
  castingPlayer: params.castingPlayer,
  sourceCardId: params.sourceCardId,
  originZone: params.originZone,
  asSpecialAction: params.asSpecialAction,
  faceChosen: undefined,
  alternativeZoneDestination: undefined,
  altCostUsed: null,
  additionalCostsPaid: [],
  modesChosen: [],
  xValue: undefined,
  distributions: undefined,
  targets: undefined,
  totalCost: undefined,
  paidAlready: [],
});

// SPDX-License-Identifier: GPL-3.0-or-later
// StackItem — a rich record on the stack representing a spell or ability in
// flight. Unlike Zone which stores EntityIds of cards, the Stack stores
// StackItems themselves because a single card can put multiple stack items
// on the stack simultaneously (e.g. storm copies, modal-multiple-targets).
//
// SP1 scope: shape + provenance definition only. Targeting (SP2 Task 40),
// cost-paid payloads (SP3), and copy/cascade propagation (SP2) each refine
// the typed slots that currently read `unknown`.
import type { EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";

/**
 * StackItemProvenance — metadata that records HOW a spell/ability reached the
 * stack. Used by triggered abilities ("whenever you cast a spell from
 * exile"), replacement effects (Panglacial Wurm casting from library), and
 * cascade/copy chains that need to know the source item.
 */
export interface StackItemProvenance {
  readonly originZone: ZoneType;
  readonly altCostUsed: string | null;
  readonly additionalCostsPaid: readonly string[];
  readonly cascadeOrigin?: EntityId;
  readonly copiedFrom?: EntityId;
  readonly alternativeZoneDestination?: ZoneType;
  // SP2 Task 35 — captured by CastPipeline on finalize. Consulted by stack
  // resolvers and triggers (e.g. "when you cast a spell's adventure"):
  //   faceChosen   — split / DFC / adventure face picked in step 2.
  //   modesChosen  — modal-spell mode ids selected in step 5.
  //   xValue       — X value chosen in step 5 (null if card has no X).
  readonly faceChosen?: "front" | "back" | "L" | "R" | "adventure";
  readonly modesChosen?: readonly string[];
  readonly xValue?: number;
}

/**
 * StackItem — the record type pushed on the Stack. Rich slots (`targets`,
 * `modes`, `costPaid`) are deliberately typed `unknown` / `readonly unknown[]`
 * in SP1 because the concrete shapes (TargetChoices, PaidCost) land in SP2's
 * targeting milestone and SP3's cost-system completion respectively.
 */
export interface StackItem {
  readonly id: EntityId;
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly kind: "spell" | "activatedAbility" | "triggeredAbility" | "copy";
  readonly isCast: boolean;
  // WHY: TargetChoices structure is defined in SP2 Task 40; holding `unknown`
  // keeps the StackItem shape stable without leaking unreleased types.
  readonly targets: unknown;
  readonly modes: readonly unknown[];
  readonly xValue: number | null;
  // WHY: PaidCost (the structured record of which mana/costs were actually
  // spent for this cast) is SP3's output; unknown here matches that bound.
  readonly costPaid: unknown;
  readonly provenance: StackItemProvenance;
}

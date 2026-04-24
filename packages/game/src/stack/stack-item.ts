// SPDX-License-Identifier: GPL-3.0-or-later
// StackItem — a rich record on the stack representing a spell or ability in
// flight. Unlike Zone which stores EntityIds of cards, the Stack stores
// StackItems themselves because a single card can put multiple stack items
// on the stack simultaneously (e.g. storm copies, modal-multiple-targets).
//
// SP1 scope: shape + provenance definition only. Targeting (SP2 Task 40),
// cost-paid payloads (SP3), and copy/cascade propagation (SP2) each refine
// the typed slots that currently read `unknown`.
import type { EntityId, GameEvent, LastKnownInfo, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";

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
  // SP2 Task 40 — triggered-ability-only metadata. The priority orchestrator
  // drains fired triggers from the registry and pushes one StackItem per
  // trigger; these optional slots let Task 67 (resolve-time decisions) walk
  // back to the originating TriggeredAbility and the LKI snapshot captured
  // at fire time. Undefined on spell / activated / copy items.
  readonly triggerId?: EntityId;
  readonly lki?: LastKnownInfo | null;
  // SP2 Task 67 — the GameEvent that fired this trigger (triggeredAbility
  // items only). Resolve-time intervening-if re-check needs the original
  // event; capturing it here keeps the check self-contained instead of
  // forcing a lookup against a separately-stored trigger context map.
  readonly event?: GameEvent;
  // SP2 Task 67 — resolve-time body. When present, resolveStackItem drives
  // the resolver's generator (forwarding decisions + events to the caller)
  // before emitting StackItemResolved. SP2 doesn't yet populate this field
  // from CastPipeline / trigger push (SP3 wires the real resolvers); tests
  // use it directly. `unknown` in the generator type keeps this file free
  // of core/game circular imports — the concrete yield shape is EngineYield
  // from action/engine-yield.js, narrowed by the resolver impl.
  readonly resolver?: StackItemResolver | null;
}

/**
 * SP2 Task 67 — a resolve-time body attached to a StackItem. When the stack
 * item resolves, `resolve(game)` runs first (yielding decisions / events as
 * needed); then resolveStackItem emits StackItemResolved and handles the
 * source-card zone change.
 *
 * Typed with `unknown` for yield/return to avoid a core→game circular
 * import. The runtime shape is EngineYield; resolveStackItem re-narrows
 * through an explicit cast.
 */
export interface StackItemResolver {
  resolve(game: unknown): Generator<unknown, void, unknown>;
}

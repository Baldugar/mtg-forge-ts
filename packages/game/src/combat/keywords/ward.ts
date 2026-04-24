// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.21 — Ward N. Whenever a permanent with ward becomes the target of
// a spell or ability an opponent controls, counter that spell/ability unless
// its controller pays N (mana/life/other cost variants). Implemented as a
// replacement-style effect fired at the "target-locking" step of the cast
// pipeline.
//
// SP2 scope: expose the factory + the expected intent shape. Wiring of the
// "targeted" MutationIntent lives in Milestone U (SP3's resolve-time
// decisions, Task 67) and the cast pipeline's stepChooseTargets. Today the
// factory produces a ReplacementAbility whose `matches` returns false for
// every intent — a harmless no-op that keeps the registry-shape contract
// satisfied while SP3 wires the real behavior.
//
// Downstream (SP3) integration note: stepChooseTargets should construct a
// `{ kind: "targeted", targetCardId, spellControllerSeat, stackItemId }`
// intent per target locked; ward's `matches` narrows on that kind, checks
// `targetCardId === sourceCardId`, rejects same-controller targeting, and
// `apply` requires a Ward-cost payment via a choice decision before
// letting the intent through.
import type { EntityId, PlayerSeat, ReplacementAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";

export interface WardReplacementOptions {
  readonly sourceCardId: EntityId;
  readonly wardAmount: number;
  readonly id: EntityId;
  readonly controllerSeat: PlayerSeat;
  /**
   * Timestamp for CR 613 ordering. Defaults to 0 (below every SP3
   * timestamp); callers that register ward alongside a real timeline
   * should pass the card's per-instance stamp.
   */
  readonly timestamp?: number;
}

export const createWardReplacement = (opts: WardReplacementOptions): ReplacementAbility => {
  return {
    id: opts.id,
    kind: "replacement",
    sourceCardId: opts.sourceCardId,
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: opts.timestamp ?? 0,
    controllerSeatAtReg: opts.controllerSeat,
    // SP2 no-op: no "targeted" MutationIntent exists yet. Returning false
    // here means the apply-loop ignores this replacement entirely. When
    // the cast pipeline emits the intent (SP3 Milestone U), this closure
    // will narrow on kind === "targeted" and check sourceCardId.
    matches: (_intent) => false,
    // SP2 identity apply: returns the intent unchanged. SP3 will consult
    // the ward amount (opts.wardAmount) and issue a pay-or-counter
    // decision before letting the intent through, returning null when
    // the targeted spell/ability is countered.
    apply: (intent) => intent,
    // Ward is NOT a self-replacement for ETB ordering (CR 614.1c-d) — it
    // fires against external targeting intents, not the permanent's own
    // ETB. False here keeps the apply-loop's self-replacement prefix
    // from mistakenly prioritizing ward.
    isSelfReplacement: false,
    layer: "other",
  };
};

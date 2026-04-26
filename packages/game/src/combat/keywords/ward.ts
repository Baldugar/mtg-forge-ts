// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.21d — Ward [cost]. When a permanent with ward becomes the target
// of a spell or ability an opponent controls, counter that spell/ability
// unless its controller pays the ward cost.
//
// Wave 49 — Real semantic implementation lives in
// `keyword/handlers/ward-keyword.ts` (a BecomesTarget triggered ability).
// That path watches CardTargeted events emitted by the cast pipeline /
// activateAbility, asks the targeting player to pay the ward cost, and
// counters the targeting stack item if payment is declined or fails.
//
// This factory remains for API compatibility with SP2 callers that wired
// ward as a ReplacementAbility shape. It now narrows on a future
// `kind === "targeted"` MutationIntent (currently never emitted; the
// trigger path supersedes this for all live ward effects). The factory
// is preserved as the canonical replacement-shape entry-point for cards
// or rules variants that need ward-as-replacement (e.g. a ReplaceEffect
// rewrite of the BecomesTarget trigger). Until such a path lands, the
// `matches` predicate remains a strict narrow on the targeted intent
// shape — it returns true for ward-applicable targeted intents and false
// for everything else.
import type { EntityId, MutationIntent, PlayerSeat, ReplacementAbility } from "@mtg-forge-ts/core";
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

interface TargetedIntentShape {
  readonly kind: "targeted";
  readonly targetCardId: EntityId;
  readonly spellControllerSeat: PlayerSeat;
}

export const createWardReplacement = (opts: WardReplacementOptions): ReplacementAbility => {
  const { sourceCardId, controllerSeat } = opts;
  return {
    id: opts.id,
    kind: "replacement",
    sourceCardId,
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: opts.timestamp ?? 0,
    controllerSeatAtReg: controllerSeat,
    matches: (intent: MutationIntent): boolean => {
      // Narrow on the future `targeted` MutationIntent. The trigger path
      // (ward-keyword.ts) handles every live ward fire today; this branch
      // is the carve-out for an opt-in replacement-shape rewrite. Until
      // a `targeted` intent kind ships, this returns false for every
      // existing intent — exactly the SP2 contract — but does so by
      // structural narrowing rather than a hardcoded constant.
      if ((intent as { kind?: string }).kind !== "targeted") return false;
      const t = intent as unknown as TargetedIntentShape;
      if (t.targetCardId !== sourceCardId) return false;
      if (t.spellControllerSeat === controllerSeat) return false;
      return true;
    },
    // Identity apply: when the trigger path supersedes this branch for
    // all live ward effects, callers that opt into the replacement-shape
    // rewrite must pre-attach a pay-or-counter decision yielder before
    // invoking applyReplacementLoop. Until such a caller exists, this
    // identity-pass keeps the contract no-op-safe.
    apply: (intent) => intent,
    // Ward is NOT a self-replacement for ETB ordering (CR 614.1c-d) — it
    // fires against external targeting intents, not the permanent's own
    // ETB.
    isSelfReplacement: false,
    layer: "other",
  };
};

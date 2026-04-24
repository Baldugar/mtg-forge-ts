// SPDX-License-Identifier: GPL-3.0-or-later
// TargetSystem — CR 601/608 targeting at cast time and resolve time.
//
// Contract:
//   - `enumerate(ctx, restriction)` returns every eligible TargetRef under
//     the current game state.
//   - `validateAtCast(choices, ctx, restriction)` returns true iff the
//     submitted choices are a subset of the eligibility set AND satisfy
//     count + divideX + uniqueness constraints (CR 601.2c).
//   - `validateAtResolve(choices, ctx, restriction)` re-runs eligibility at
//     resolve time and partitions the choices into { legal, illegal } so
//     the stack-item resolver can fizzle or recompute effects (CR 608.2b).
//   - `redirect(choices, originalRef, replacementRef)` substitutes one
//     target for another while preserving `divisions` (used by replacement
//     effects such as "damage that would be dealt to you is dealt to X
//     instead").
//
// Wired onto Game.targetSystem in the Game ctor.
import type { Game } from "../game.js";
import { type EnumerationContext, enumerateEligibleTargets } from "./enumeration.js";
import type { TargetChoices, TargetRef, TargetRestriction } from "./restriction.js";
import { refEquals } from "./restriction.js";

export class TargetSystem {
  constructor(private readonly game: Game) {}

  /**
   * Return every TargetRef the restriction admits under current state.
   * Delegates to enumerateEligibleTargets; kept as a method for discoverability
   * and so consumers can stub the whole system for testing in isolation.
   */
  enumerate(ctx: EnumerationContext, restriction: TargetRestriction): readonly TargetRef[] {
    return enumerateEligibleTargets(this.game, ctx, restriction);
  }

  /**
   * CR 601.2c — legality check before the spell/ability goes on the stack.
   * Returns true iff:
   *   1. target count is within [minTargets, maxTargets],
   *   2. every chosen ref is a member of the current eligibility set,
   *   3. no target is listed twice (CR 115.1b — a single target-requiring
   *      spell cannot target the same object twice unless it says "any
   *      number"; SP2 enforces strict uniqueness, a future restriction flag
   *      can relax it for cards that genuinely allow duplicates),
   *   4. if `divideX` is set, every chosen index has a non-negative integer
   *      amount and the sum equals `divideX.amount`.
   */
  validateAtCast(choices: TargetChoices, ctx: EnumerationContext, restriction: TargetRestriction): boolean {
    // 1. Count check.
    if (choices.targets.length < restriction.minTargets) return false;
    if (choices.targets.length > restriction.maxTargets) return false;

    // 2. Divide-X check (if applicable). Done before eligibility so we can
    //    short-circuit on malformed divisions before paying the enumeration
    //    cost on restrictions with large eligibility sets.
    if (restriction.divideX !== undefined) {
      const divisions = choices.divisions ?? {};
      let sum = 0;
      for (let i = 0; i < choices.targets.length; i++) {
        const amt = divisions[i];
        if (typeof amt !== "number" || amt < 0 || !Number.isInteger(amt)) return false;
        sum += amt;
      }
      if (sum !== restriction.divideX.amount) return false;
    }

    // 3. Uniqueness check.
    const seen = new Set<string>();
    for (const t of choices.targets) {
      const key = refKey(t);
      if (seen.has(key)) return false;
      seen.add(key);
    }

    // 4. Eligibility check — each chosen ref must appear in the current
    //    enumeration set. Linear scan is fine at ~O(targets·eligible);
    //    real restrictions rarely produce more than a handful of chosen
    //    refs and eligibility sets are bounded by battlefield size.
    const eligible = enumerateEligibleTargets(this.game, ctx, restriction);
    for (const chosen of choices.targets) {
      const match = eligible.some((e) => refEquals(e, chosen));
      if (!match) return false;
    }

    return true;
  }

  /**
   * CR 608.2b — re-check eligibility at resolution. Returns the partition
   * of the submitted choices into targets still legal and targets now
   * illegal (zone-changed, type-changed, control-changed, …). The stack-item
   * resolver fizzles the effect when every target is illegal (CR 608.2b)
   * and recomputes per-target effects when only some are illegal.
   */
  validateAtResolve(
    choices: TargetChoices,
    ctx: EnumerationContext,
    restriction: TargetRestriction,
  ): { readonly legal: readonly TargetRef[]; readonly illegal: readonly TargetRef[] } {
    const eligible = enumerateEligibleTargets(this.game, ctx, restriction);
    const legal: TargetRef[] = [];
    const illegal: TargetRef[] = [];
    for (const chosen of choices.targets) {
      const match = eligible.some((e) => refEquals(e, chosen));
      if (match) legal.push(chosen);
      else illegal.push(chosen);
    }
    return { legal, illegal };
  }

  /**
   * Substitute `replacementRef` for every occurrence of `originalRef` in
   * `choices.targets`. `divisions` is preserved verbatim — the index of the
   * replaced slot still points at the same numeric amount, now carrying
   * the replacement ref. If `originalRef` is not present, the returned
   * choices are structurally equivalent to the input.
   *
   * Used by replacement effects: "damage that would be dealt to you is dealt
   * to X instead" rewrites the targets-list on an in-flight stack item so
   * the subsequent resolution hits X instead.
   */
  redirect(choices: TargetChoices, originalRef: TargetRef, replacementRef: TargetRef): TargetChoices {
    const newTargets: TargetRef[] = [];
    for (const t of choices.targets) {
      if (refEquals(t, originalRef)) {
        newTargets.push(replacementRef);
      } else {
        newTargets.push(t);
      }
    }
    const out: TargetChoices =
      choices.divisions !== undefined
        ? { targets: newTargets, divisions: { ...choices.divisions } }
        : { targets: newTargets };
    return out;
  }
}

/** Stable string key for a TargetRef, used by uniqueness check. */
const refKey = (r: TargetRef): string => {
  switch (r.kind) {
    case "card":
      return `c:${r.id}`;
    case "player":
      return `p:${r.seat}`;
    default: {
      const _: never = r;
      throw new Error(`refKey: unreachable ${JSON.stringify(_)}`);
    }
  }
};

export type { TargetChoices, TargetRef, TargetRestriction } from "./restriction.js";
export type { EnumerationContext } from "./enumeration.js";

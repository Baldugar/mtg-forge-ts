// SPDX-License-Identifier: GPL-3.0-or-later
// solveManaPayment — greedy mana-payment solver.
//
// Given a ManaCost and a ManaPool snapshot, determines whether payment is
// possible and, if so, returns a ManaPaymentPlan describing which pool entries
// to consume and how much life to pay (for phyrexian pips).
//
// Algorithm
// ---------
// 1. Expand the cost into a pip list via ManaCostBeingPaid.
// 2. Sort the pip list by specificity (most constrained first):
//      colored > colorless > snow > hybrid > monoHybrid > colorlessHybrid
//      > phyrexian > hybridPhyrexian > generic
//    This prevents spending a specific-colored pool entry on a generic pip
//    that could be satisfied by the leftover mana after the colored pip is met.
// 3. For each pip (in specificity order):
//    a. Find the best pool entry that satisfies it (first-match within the
//       eligible set — sufficient for greedy correctness given the sort order).
//    b. Record the consumption (pool index + symbol) in the plan.
//    c. Remove that pool entry from the working copy of the pool.
//    d. For phyrexian/hybridPhyrexian: if no pool entry qualifies, fall back
//       to paying 2 life (add 2 to lifePaid).
//    e. If no pool entry and no life fallback: return null (unpayable).
// 4. Return the plan.
//
// Greedy correctness note
// -----------------------
// Sorting pips by specificity is the key invariant. Without it a colored pip
// solved later might find no remaining pool entry of the required color because
// an earlier generic pip greedily consumed the only matching entry. With the
// sort, every specific pip is resolved before any generic pip, so generic pips
// only consume pool entries that no specific pip can use.
//
// monoHybrid simplification
// --------------------------
// monoHybrid (2/W) can pay "1 W" OR "2 generic". The greedy solver always
// tries the 1-colored branch first (monoHybrid pips sort between hybrid and
// colorlessHybrid). If the pool has the matching color, one entry is consumed;
// if not, one generic entry is consumed (falling back to the "2 generic" branch
// at the cost of under-paying by 1 — the spec acknowledges this MVP limitation
// and documents it here so it can be addressed in a future milestone).

import type { ManaCost } from "@mtg-forge-ts/core";
import type { ManaProduced, ManaSymbol } from "@mtg-forge-ts/core";
import type { ManaPool } from "../mana-pool.js";
import { ManaCostBeingPaid, pipSatisfiedBy } from "./mana-cost-being-paid.js";

/** Specificity ordering: lower number = more constrained = handled first. */
function pipSpecificity(pip: ManaSymbol): number {
  switch (pip.kind) {
    case "colored":
      return 0;
    case "colorless":
      return 1;
    case "snow":
      return 2;
    case "hybrid":
      return 3;
    case "monoHybrid":
      return 4;
    case "colorlessHybrid":
      return 5;
    case "phyrexian":
      return 6;
    case "hybridPhyrexian":
      return 7;
    case "generic":
      return 8;
    case "variable":
      // Should not appear after binding in ManaCostBeingPaid; treat as generic.
      return 8;
    case "coloredX":
      // Wire-format only; treat as generic.
      return 8;
    default: {
      const _exhaustive: never = pip;
      throw new Error(`pipSpecificity: unhandled kind: ${(_exhaustive as ManaSymbol).kind}`);
    }
  }
}

export interface ManaPaymentPlan {
  /** Each consumed pool entry: the ManaProduced and its original pool index. */
  readonly consumed: readonly { readonly symbol: ManaProduced; readonly poolIndex: number }[];
  /** Total life paid via phyrexian alternative payments. */
  readonly lifePaid: number;
  /** Bound X value, if the cost had X pips. */
  readonly xValue?: number;
}

/**
 * Attempt to pay `cost` from the given pool. Returns a ManaPaymentPlan on
 * success, or null if the cost cannot be paid from the pool + life.
 *
 * The pool is NOT mutated — the plan records which indices to remove and the
 * caller applies it via applyPaymentPlan.
 */
export const solveManaPayment = (
  cost: ManaCost,
  pool: ManaPool,
  options?: { readonly xValue?: number },
): ManaPaymentPlan | null => {
  const xValue = options?.xValue ?? 0;

  // Build an ordered pip list from the cost with X bound.
  const tracker = new ManaCostBeingPaid(cost.symbols, xValue);

  // Get a mutable working copy of pool entries (index → entry).
  // We track "available" via a boolean mask so original indices are preserved.
  const poolEntries = pool.toArray();
  const available = poolEntries.map(() => true);

  // Extract and sort the pip list by specificity.
  const pips = [...tracker.remainingPips()].sort((a, b) => pipSpecificity(a) - pipSpecificity(b));

  const consumed: { symbol: ManaProduced; poolIndex: number }[] = [];
  let lifePaid = 0;

  for (const pip of pips) {
    // Find the first available pool entry that satisfies this pip.
    let found = false;
    for (let i = 0; i < poolEntries.length; i++) {
      if (!available[i]) continue;
      const entry = poolEntries[i];
      if (entry === undefined) continue;
      if (pipSatisfiedBy(pip, entry)) {
        consumed.push({ symbol: entry, poolIndex: i });
        available[i] = false;
        found = true;
        break;
      }
    }

    if (!found) {
      // Life fallback for phyrexian pips.
      if (pip.kind === "phyrexian" || pip.kind === "hybridPhyrexian") {
        lifePaid += 2;
        found = true;
      }
    }

    if (!found) {
      return null; // Unpayable.
    }
  }

  const plan: ManaPaymentPlan = {
    consumed,
    lifePaid,
    ...(cost.countX() > 0 ? { xValue } : {}),
  };
  return plan;
};

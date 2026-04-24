// SPDX-License-Identifier: GPL-3.0-or-later
// chooseX — yields a "chooseX" decision and returns the chosen X value.
//
// Used by CostMana.pay when the mana cost contains one or more variable (X)
// pips. The engine yields a DecisionRequest of kind "chooseX" and waits for
// the PlayerController to supply a response.
//
// maxBound computation
// --------------------
// The rough upper bound on X is:
//   poolSize - nonXRequiredPips
// where nonXRequiredPips is the number of pips in the cost that are NOT
// variable (i.e. colored, generic, hybrid, etc.). This is a conservative
// upper bound — it ignores color requirements on non-X pips (those might
// further restrict usable pool entries) but is sufficient for M5 MVP.
// A future milestone can tighten the bound by running solveManaPayment with
// increasing X values and finding the maximum feasible X.

import type { EntityId } from "@mtg-forge-ts/core";
import type { ManaCost } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { ManaPool } from "../mana-pool.js";

/**
 * Compute a rough upper bound for X given the cost and current pool.
 * Returns the number of pool entries available after reserving one slot
 * for each non-variable, non-generic pip (a generous bound; real
 * color-constraint tightening deferred to a later milestone).
 */
export function computeMaxX(cost: ManaCost, pool: ManaPool): number {
  // Count non-X pips that are NOT generic (each needs at least 1 pool entry).
  let nonXNonGenericPips = 0;
  let genericPipTotal = 0;
  for (const sym of cost.symbols) {
    switch (sym.kind) {
      case "generic":
        genericPipTotal += sym.amount;
        break;
      case "variable":
        // variable pips are the X pips — don't count them.
        break;
      case "coloredX":
        // Skip; wire-format only.
        break;
      default:
        nonXNonGenericPips += 1;
        break;
    }
  }
  const reservedForNonX = nonXNonGenericPips + genericPipTotal;
  const available = Math.max(0, pool.size() - reservedForNonX);
  return available;
}

/**
 * Yields a "chooseX" decision to the PlayerController and returns the
 * chosen X value (non-negative integer).
 *
 * @param sourceCardId  The EntityId of the card being cast (for the request).
 * @param maxBound      The computed upper bound for X.
 */
export function* chooseX(sourceCardId: EntityId, maxBound: number): Generator<EngineYield, number, unknown> {
  const request: EngineYield = {
    kind: "decision",
    request: {
      kind: "chooseX",
      sourceId: sourceCardId,
      maxX: maxBound,
    },
  };
  const response = yield request;
  // The driver loop sends a DecisionResponse back as the .next() value.
  // We cast it to extract the chosen x.
  const resp = response as { kind: string; x?: number } | undefined;
  if (resp?.kind === "chooseX" && typeof resp.x === "number") {
    return Math.max(0, Math.min(resp.x, maxBound));
  }
  // Fallback: if no valid response (e.g. test harness ignores decisions), default to 0.
  return 0;
}

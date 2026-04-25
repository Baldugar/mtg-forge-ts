// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — applyCostMods. Folds a list of CostModEffect deltas into a
// ManaCost before solveManaPayment sees it. Used by CostMana.canPay/pay.
//
// Reductions are floored at minGenericFloor (Forge's MinMana$ param;
// defaults to 0) so a -3 reduction on a {1B} cost produces {B}, not {-2B}.
//
// MVP scope:
//   - Only delta.generic is applied (positive or negative).
//   - delta.color / delta.deltaColor (raise/reduce a specific colored pip)
//     is parsed but unused — handlers throw if a script needs it before we
//     plumb it through.
//   - No-cost (hasNoCost) ManaCosts are returned unchanged: there is no
//     generic block to fold into.
import { ManaCost } from "@mtg-forge-ts/core";
import type { ManaSymbol } from "@mtg-forge-ts/core";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";

export const applyCostMods = (
  cost: ManaCost,
  mods: readonly CostModEffect[],
  minGenericFloor = 0,
): ManaCost => {
  if (mods.length === 0) return cost;
  if (cost.hasNoCost) return cost;
  let genericDelta = 0;
  for (const m of mods) {
    if (m.delta.generic !== undefined) genericDelta += m.delta.generic;
  }
  if (genericDelta === 0) return cost;

  // Walk the symbol list; sum existing generic amounts; everything else passes
  // through unchanged (color/hybrid/phyrexian/X pips remain as-is).
  let existingGeneric = 0;
  const nonGeneric: ManaSymbol[] = [];
  for (const s of cost.symbols) {
    if (s.kind === "generic") existingGeneric += s.amount;
    else nonGeneric.push(s);
  }
  const newGeneric = Math.max(minGenericFloor, existingGeneric + genericDelta);

  const symbols: ManaSymbol[] = [];
  if (newGeneric > 0) symbols.push({ kind: "generic", amount: newGeneric });
  symbols.push(...nonGeneric);
  return new ManaCost(symbols, false);
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 baseline + Wave 11 completeness — applyCostMods folds a list of
// CostModEffect deltas into a ManaCost before solveManaPayment sees it.
//
// Wave 11 (cost-mod runtime completeness) extensions:
//   - `minMana` (MinMana$): per-mod floor on the resulting generic count.
//     When multiple mods apply, the floor is the MAX of all participating
//     mods' minMana — the most restrictive wins (Forge semantics).
//   - `delta.generic` may be a function — evaluated per-cast for non-numeric
//     Amount$ expressions (Yavimaya Sojourner: `Amount$ X` with `X:Count$Domain`).
//   - `delta.addSymbols` / `delta.subtractSymbols`: Cost$-form colored-pip
//     raise/reduce. Add concatenates; subtract removes one matching pip per
//     symbol (no-op if the cost doesn't carry that pip).
//   - `setMinTotal` (SetCost mode): after deltas + symbol mutations, top up
//     generic so the resulting cost's mana value reaches the floor. When
//     multiple SetCost mods apply, the max wins.
//
// The "item" + "game" pair is threaded through so dynamic-amount closures
// can inspect game state (graveyards, lands, etc.) at apply time.
import { ManaCost } from "@mtg-forge-ts/core";
import type { ManaSymbol } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";

// Structural equality for ManaSymbol (small discriminated union — no library
// helper exists; comparing kind + relevant fields is sufficient).
const symbolEqual = (a: ManaSymbol, b: ManaSymbol): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "generic":
      return a.amount === (b as { amount: number }).amount;
    case "variable":
      return a.letter === (b as { letter: string }).letter;
    case "colored":
    case "phyrexian":
    case "colorlessHybrid":
      return a.color === (b as { color: number }).color;
    case "monoHybrid":
      return a.color === (b as { color: number }).color;
    case "hybrid":
    case "hybridPhyrexian":
      return a.a === (b as { a: number }).a && a.b === (b as { b: number }).b;
    case "colorless":
    case "snow":
    case "coloredX":
      return true;
  }
};

const evalGeneric = (m: CostModEffect, item: unknown, game: Game | undefined): number => {
  const g = m.delta.generic;
  if (g === undefined) return 0;
  if (typeof g === "function") {
    if (game === undefined) {
      throw new Error("applyCostMods: dynamic generic delta requires `game` argument");
    }
    return g(item, game);
  }
  return g;
};

export const applyCostMods = (
  cost: ManaCost,
  mods: readonly CostModEffect[],
  opts: { item?: unknown; game?: Game } = {},
): ManaCost => {
  if (mods.length === 0) return cost;
  if (cost.hasNoCost) return cost;

  const item = opts.item;
  const game = opts.game;

  // Sum generic delta (resolving dynamic closures) and aggregate floors.
  let genericDelta = 0;
  let minManaFloor = 0;
  let setMinTotalFloor = -1; // -1 sentinel = no SetCost mod participated
  const addSymbolsAccum: ManaSymbol[] = [];
  const subtractSymbolsAccum: ManaSymbol[] = [];
  for (const m of mods) {
    genericDelta += evalGeneric(m, item, game);
    if (m.minMana !== undefined && m.minMana > minManaFloor) minManaFloor = m.minMana;
    if (m.setMinTotal !== undefined && m.setMinTotal > setMinTotalFloor) {
      setMinTotalFloor = m.setMinTotal;
    }
    if (m.delta.addSymbols && m.delta.addSymbols.length > 0) {
      for (const s of m.delta.addSymbols) addSymbolsAccum.push(s);
    }
    if (m.delta.subtractSymbols && m.delta.subtractSymbols.length > 0) {
      for (const s of m.delta.subtractSymbols) subtractSymbolsAccum.push(s);
    }
  }

  const noChanges =
    genericDelta === 0 &&
    addSymbolsAccum.length === 0 &&
    subtractSymbolsAccum.length === 0 &&
    setMinTotalFloor < 0;
  if (noChanges) return cost;

  // Walk the symbol list; sum existing generic amounts; everything else passes
  // through unchanged (color/hybrid/phyrexian/X pips remain as-is).
  let existingGeneric = 0;
  let nonGeneric: ManaSymbol[] = [];
  for (const s of cost.symbols) {
    if (s.kind === "generic") existingGeneric += s.amount;
    else nonGeneric.push(s);
  }

  // Subtract symbols (Cost$ colored reduce). Each subtract symbol consumes
  // one matching non-generic pip; if no match, skip silently (Forge: the
  // reduction simply doesn't apply for that pip).
  for (const sub of subtractSymbolsAccum) {
    if (sub.kind === "generic") {
      // Treat a generic subtract symbol as additional generic delta — rare
      // but Forge does allow `Cost$ 2 W` style "reduce by {2}{W}".
      genericDelta -= sub.amount;
      continue;
    }
    const idx = nonGeneric.findIndex((s) => symbolEqual(s, sub));
    if (idx >= 0) nonGeneric = nonGeneric.slice(0, idx).concat(nonGeneric.slice(idx + 1));
  }

  // Add symbols (Cost$ colored raise). Generic-typed added symbols fold into
  // the generic delta; everything else appends to nonGeneric.
  const addedNonGeneric: ManaSymbol[] = [];
  for (const add of addSymbolsAccum) {
    if (add.kind === "generic") {
      genericDelta += add.amount;
      continue;
    }
    addedNonGeneric.push(add);
  }

  let newGeneric = Math.max(minManaFloor, existingGeneric + genericDelta);

  // SetCost / RaiseTo: ensure the resulting cmc reaches setMinTotalFloor.
  if (setMinTotalFloor >= 0) {
    // Compute the would-be cmc: newGeneric + nonGeneric.length + addedNonGeneric.length.
    // Each non-generic colored / hybrid / phyrexian / etc. pip contributes 1
    // to mana value (Forge's MV math; X is 0 absent xValue, snow=1, etc.).
    const nonGenericCount = nonGeneric.length + addedNonGeneric.length;
    const currentMv = newGeneric + nonGenericCount;
    if (currentMv < setMinTotalFloor) {
      newGeneric += setMinTotalFloor - currentMv;
    }
  }

  const symbols: ManaSymbol[] = [];
  if (newGeneric > 0) symbols.push({ kind: "generic", amount: newGeneric });
  symbols.push(...nonGeneric);
  symbols.push(...addedNonGeneric);
  return new ManaCost(symbols, false);
};

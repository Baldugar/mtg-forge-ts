// SPDX-License-Identifier: GPL-3.0-or-later
// ManaCostBeingPaid — mutable tracker for "what mana pips remain to be paid".
//
// Initialized from a ManaCost; internally stores pips as an array of
// ManaSymbol entries with generic{amount:N} expanded into N individual
// generic{amount:1} entries. Consuming a ManaProduced from the pool removes
// the first pip it satisfies.
//
// Pip-satisfaction rules (MVP subset):
//   colored W   ← ManaProduced.color === Color.White
//   colorless   ← ManaProduced.color === null (truly colorless "C")
//   snow        ← ManaProduced.isSnow === true
//   generic     ← any ManaProduced (colored, colorless, snow, any)
//   hybrid W/U  ← ManaProduced.color === White OR Blue
//   monoHybrid 2/W — MVP simplification: ALWAYS treat as the colored branch
//                    (pay 1 colored rather than 2 generic). If the incoming
//                    mana matches the color, pay it; otherwise fall back and
//                    treat as generic (pay any). This is a documented MVP
//                    simplification — the monoHybrid "2" branch would require
//                    reserving 2 generic pool slots which the current greedy
//                    1-pip-per-consume model cannot express cleanly.
//   phyrexian W/P ← color W pays the mana branch; life payment is handled at
//                    solver level (caller decides life vs mana). For this
//                    tracker, phyrexian pips are NEVER satisfied by consume —
//                    the solver bypasses consume and records life payment.
//   colorlessHybrid C/W ← colorless OR color W
//   hybridPhyrexian B/G/P ← color B OR G (life branch at solver level)
//   coloredX    — skip (wire-format only; not produced by text parser)
//   variable    — bind X before use; after binding, treated as generic{xValue}

import type { ManaSymbol } from "@mtg-forge-ts/core";
import type { ManaProduced } from "@mtg-forge-ts/core";
import { Color } from "@mtg-forge-ts/core";

/** Expand a ManaCost's symbol list into individual 1-pips for payment tracking. */
function expandSymbols(symbols: readonly ManaSymbol[], xValue: number): ManaSymbol[] {
  const pips: ManaSymbol[] = [];
  for (const sym of symbols) {
    switch (sym.kind) {
      case "generic":
        // Expand N-generic into N individual 1-generic pips.
        for (let i = 0; i < sym.amount; i++) {
          pips.push({ kind: "generic", amount: 1 });
        }
        break;
      case "variable":
        // Bind to xValue: expand into xValue individual 1-generic pips.
        for (let i = 0; i < xValue; i++) {
          pips.push({ kind: "generic", amount: 1 });
        }
        break;
      case "coloredX":
        // Wire-format only; skip for MVP.
        break;
      default:
        // All other kinds are 1-pip each: colored, colorless, snow, hybrid,
        // monoHybrid, phyrexian, colorlessHybrid, hybridPhyrexian.
        pips.push(sym);
        break;
    }
  }
  return pips;
}

/**
 * Returns true if the incoming ManaProduced can satisfy the given pip.
 * Phyrexian/hybridPhyrexian: the life branch is NOT handled here (caller
 * skips consume and pays life instead). Only the mana branch is checked.
 */
export function pipSatisfiedBy(pip: ManaSymbol, mana: ManaProduced): boolean {
  switch (pip.kind) {
    case "colored":
      return mana.color === pip.color;
    case "colorless":
      // Colorless "C" pip requires truly colorless mana (color === null).
      return mana.color === null;
    case "snow":
      // Snow pip satisfied by any snow-source mana.
      return mana.isSnow;
    case "generic":
      // Generic pip satisfied by any mana.
      return true;
    case "hybrid": {
      // W/U hybrid: satisfied by mana of color a OR b.
      return mana.color === pip.a || mana.color === pip.b;
    }
    case "monoHybrid": {
      // MVP: prefer the colored branch. Satisfied by color match OR any mana
      // (fallback generic branch). Always returns true — but caller should
      // prefer color-matching consume via the solver ordering.
      // WHY: The monoHybrid "2 generic" branch would consume 2 pool slots per
      // pip, which breaks the 1-pip-per-consume model. We treat any mana as
      // satisfying a monoHybrid pip, but the solver orders colored pips first
      // and passes colored mana for monoHybrid when available.
      return true;
    }
    case "phyrexian":
      // Mana branch: must match the color. Life branch handled externally.
      return mana.color === pip.color;
    case "colorlessHybrid":
      // C/W: colorless (null) OR the specific color.
      return mana.color === null || mana.color === pip.color;
    case "hybridPhyrexian":
      // Mana branch: color a OR color b. Life branch handled externally.
      return mana.color === pip.a || mana.color === pip.b;
    case "coloredX":
    case "variable":
      // Not reachable after expansion; return false for safety.
      return false;
    default: {
      const _exhaustive: never = pip;
      throw new Error(`pipSatisfiedBy: unhandled pip kind: ${(_exhaustive as ManaSymbol).kind}`);
    }
  }
}

export class ManaCostBeingPaid {
  /** Remaining pips (ManaSymbol), in expanded form (no N-generic; variable bound). */
  private readonly pips: ManaSymbol[];

  /**
   * @param symbols — ManaCost.symbols (unexpanded)
   * @param xValue  — bound X value; variable pips become this many generic:1
   */
  constructor(symbols: readonly ManaSymbol[], xValue = 0) {
    this.pips = expandSymbols(symbols, xValue);
  }

  /** All pips still requiring payment. */
  remainingPips(): readonly ManaSymbol[] {
    return [...this.pips];
  }

  /** True when all pips have been consumed. */
  isPaid(): boolean {
    return this.pips.length === 0;
  }

  /**
   * Returns true if the given ManaProduced can satisfy at least one remaining pip.
   * Returns false when cost is already fully paid.
   */
  canConsume(symbol: ManaProduced): boolean {
    if (this.pips.length === 0) return false;
    for (const pip of this.pips) {
      if (pipSatisfiedBy(pip, symbol)) return true;
    }
    return false;
  }

  /**
   * Consume one pip satisfied by the given ManaProduced.
   * Picks the FIRST pip (by current list order) that the symbol satisfies.
   * Throws if no pip is satisfied.
   *
   * Caller should pass pips pre-sorted by specificity (the solver does this).
   */
  consume(symbol: ManaProduced): void {
    const idx = this.pips.findIndex((pip) => pipSatisfiedBy(pip, symbol));
    if (idx === -1) {
      throw new Error(
        `ManaCostBeingPaid.consume: no remaining pip satisfied by color=${String(symbol.color)} isSnow=${symbol.isSnow}`,
      );
    }
    this.pips.splice(idx, 1);
  }
}

// Re-export Color for use in tests without a direct core import.
export { Color };

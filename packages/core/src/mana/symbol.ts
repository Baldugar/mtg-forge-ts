// SPDX-License-Identifier: GPL-3.0-or-later
// Discriminated union for MTG mana-cost symbols and the error type used by the
// parser. The corresponding ManaCost class + parse implementation lives in
// ./cost.ts so consumers can import symbols without pulling in the parser.

import type { Color } from "../color.js";

/**
 * A single mana-cost symbol, modeling the MTG mana-symbol grammar.
 *
 * - `generic`      – numeric generic cost ({0}, {1}, {2}, ..., {10}, ...)
 * - `variable`     – X/Y/Z placeholders resolved at cast time
 * - `colored`      – one of the five colors ({W}, {U}, {B}, {R}, {G})
 * - `colorless`    – explicit colorless ({C})
 * - `snow`         – snow mana ({S})
 * - `hybrid`       – two-color hybrid ({W/U}, {U/B}, ...). `a` and `b` follow
 *                    input order verbatim; we do not canonicalize so JSON
 *                    round-trips are exactly identity-preserving.
 * - `monoHybrid`   – two-generic-or-one-color hybrid ({2/W}, {2/U}, ...). The
 *                    left side is always the literal number 2 per MTG rules.
 * - `phyrexian`    – phyrexian mana ({W/P}, {U/P}, ...)
 */
export type ManaSymbol =
  | { kind: "generic"; amount: number }
  | { kind: "variable"; letter: "X" | "Y" | "Z" }
  | { kind: "colored"; color: Color }
  | { kind: "colorless" }
  | { kind: "snow" }
  | { kind: "hybrid"; a: Color; b: Color }
  | { kind: "monoHybrid"; generic: 2; color: Color }
  | { kind: "phyrexian"; color: Color };

/**
 * Thrown by {@link ManaCost.parse} when the input is not a valid mana-cost
 * string. A proper typed-error hierarchy is introduced in Task 28; this class
 * is a plain Error subclass for now.
 */
export class ManaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManaParseError";
    // Preserve prototype chain under ES2022 down-level compilation. Using
    // setPrototypeOf keeps `instanceof ManaParseError` working in all targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Discriminated union for MTG mana-cost symbols and the error type used by the
// parser. The corresponding ManaCost class + parse implementation lives in
// ./cost.ts so consumers can import symbols without pulling in the parser.

import type { Color } from "../color.js";

export type ManaSymbol =
  | { readonly kind: "generic"; readonly amount: number }
  | { readonly kind: "variable"; readonly letter: "X" | "Y" | "Z" }
  | { readonly kind: "colored"; readonly color: Color }
  | { readonly kind: "colorless" }
  | { readonly kind: "snow" }
  // Hybrid order preserved verbatim (no canonicalization) so JSON round-trips are identity-preserving.
  | { readonly kind: "hybrid"; readonly a: Color; readonly b: Color }
  | { readonly kind: "monoHybrid"; readonly generic: 2; readonly color: Color }
  | { readonly kind: "phyrexian"; readonly color: Color };

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

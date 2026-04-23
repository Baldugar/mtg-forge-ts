// SPDX-License-Identifier: GPL-3.0-or-later
// Discriminated union for MTG mana-cost symbols (Forge's ManaCostShard ported
// to TypeScript). The corresponding ManaCost class + parse implementation
// lives in ./cost.ts so consumers can import symbols without pulling in the
// parser. ManaParseError is re-exported from ../errors for backwards
// compatibility with callers that import it from this module.

import type { Color } from "../color.js";

// The kind variants mirror Forge's forge.card.mana.ManaCostShard exactly. Each
// comment gives the Forge enum name and its short parse string so the mapping
// to wire-format names is unambiguous (see cost.ts toForgeString).
//
// NOTE: hybrid/colorlessHybrid/hybridPhyrexian preserve (a, b) or (color) order
// verbatim (no canonicalization) so JSON + Forge wire-format round-trips are
// identity-preserving.
export type ManaSymbol =
  // GENERIC (forge name "GENERIC", short "1")
  | { readonly kind: "generic"; readonly amount: number }
  // X / Y / Z — IS_X shard. Forge only has a single X enum; we keep Y/Z as
  // Magic-legal variable letters so cards like Unbound Flourishing parse.
  | { readonly kind: "variable"; readonly letter: "X" | "Y" | "Z" }
  // WHITE/BLUE/BLACK/RED/GREEN
  | { readonly kind: "colored"; readonly color: Color }
  // COLORLESS (forge "COLORLESS", short "C")
  | { readonly kind: "colorless" }
  // S (forge "S", short "S")
  | { readonly kind: "snow" }
  // WU/WB/UB/UR/BR/BG/RW/RG/GW/GU
  | { readonly kind: "hybrid"; readonly a: Color; readonly b: Color }
  // W2/U2/B2/R2/G2 — "2/W" etc. (pay 2 generic or one colored)
  | { readonly kind: "monoHybrid"; readonly generic: 2; readonly color: Color }
  // WP/UP/BP/RP/GP — "W/P" (pay one colored or 2 life)
  | { readonly kind: "phyrexian"; readonly color: Color }
  // CW/CU/CB/CR/CG — "C/W" (pay one colorless or one colored)
  | { readonly kind: "colorlessHybrid"; readonly color: Color }
  // BGP/BRP/GUP/GWP/RGP/RWP/UBP/URP/WBP/WUP — "B/G/P" (hybrid two-color phyrexian)
  | { readonly kind: "hybridPhyrexian"; readonly a: Color; readonly b: Color }
  // COLORED_X — Emblazoned Golem: each color may pay for this only once.
  // Forge's shortStringValue is "1" (shared with GENERIC) so the text parser
  // cannot produce this; it reaches us via the wire-format bridge only.
  | { readonly kind: "coloredX" };

// WHY re-export: callers (including tests) historically import ManaParseError
// from "./mana/symbol.js". Re-exporting keeps that import path working while
// the canonical declaration lives in ../errors.ts as a ParseError subclass.
export { ManaParseError } from "../errors.js";

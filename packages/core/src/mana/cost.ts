// SPDX-License-Identifier: GPL-3.0-or-later
// ManaCost — immutable value object representing a parsed mana-cost string.
//
// Three input forms are accepted, matching (and extending) Forge:
//   1. Scryfall unbraced contiguous:  "2WU"            (our original form)
//   2. Scryfall braced contiguous:    "{2}{W}{U}"      (our original form)
//   3. Forge canonical space-sep:     "2 W U"          (matches ManaCostParser)
//   4. Space-separated + braces:      "{2} {W} {U}"    (harmless superset)
//
// Detection rule: if the trimmed input contains ANY whitespace characters, it
// is parsed as space-separated (forms 3/4); otherwise it uses the contiguous
// single-pass tokenizer (forms 1/2).
//
// Empty-vs-zero distinction: Forge has a hasNoCost flag on ManaCost to tell
// lands ("no cost") apart from Abeyance ("{0}"). We preserve that via the
// `hasNoCost` readonly field. Parsing "" yields hasNoCost=true, zero symbols.
// Parsing "0" yields hasNoCost=false, one {generic:0} symbol.

import { Color, ColorSet } from "../color.js";
import { ManaParseError, type ManaSymbol } from "./symbol.js";

/** Mana value (Magic's rules-defined "converted mana cost"). */
export type ManaValue = number;

// --- Forge wire-format delimiter -------------------------------------------

// Forge's ManaCost.serialize uses ASCII 0x06 as the delimiter between the
// generic count and each shard's enum .name(). We preserve the exact byte so
// deserializing data emitted by a real Forge build round-trips losslessly.
const FORGE_DELIM = "";

// --- Lookup tables ---------------------------------------------------------

const COLOR_LETTERS: Readonly<Record<string, Color>> = {
  W: Color.White,
  U: Color.Blue,
  B: Color.Black,
  R: Color.Red,
  G: Color.Green,
};

const VARIABLE_LETTERS = new Set(["X", "Y", "Z"] as const);

function isColorLetter(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(COLOR_LETTERS, ch);
}

function colorFromLetter(ch: string): Color {
  const c = COLOR_LETTERS[ch];
  if (c === undefined) {
    throw new ManaParseError(`Not a color letter: ${JSON.stringify(ch)}`);
  }
  return c;
}

// --- Forge wire-format name tables -----------------------------------------

// Maps Forge's ManaCostShard.name() strings to the symbol they decode to.
// GENERIC and numeric generic runs are handled out-of-band (the wire format
// puts the generic count as the first token before any shard names, matching
// Forge's serialize()).
const FORGE_NAME_TO_SYMBOL: Readonly<Record<string, ManaSymbol>> = {
  // Pure colors
  WHITE: { kind: "colored", color: Color.White },
  BLUE: { kind: "colored", color: Color.Blue },
  BLACK: { kind: "colored", color: Color.Black },
  RED: { kind: "colored", color: Color.Red },
  GREEN: { kind: "colored", color: Color.Green },
  COLORLESS: { kind: "colorless" },
  // Hybrid
  WU: { kind: "hybrid", a: Color.White, b: Color.Blue },
  WB: { kind: "hybrid", a: Color.White, b: Color.Black },
  UB: { kind: "hybrid", a: Color.Blue, b: Color.Black },
  UR: { kind: "hybrid", a: Color.Blue, b: Color.Red },
  BR: { kind: "hybrid", a: Color.Black, b: Color.Red },
  BG: { kind: "hybrid", a: Color.Black, b: Color.Green },
  RW: { kind: "hybrid", a: Color.Red, b: Color.White },
  RG: { kind: "hybrid", a: Color.Red, b: Color.Green },
  GW: { kind: "hybrid", a: Color.Green, b: Color.White },
  GU: { kind: "hybrid", a: Color.Green, b: Color.Blue },
  // Or 2 generic (mono-hybrid)
  W2: { kind: "monoHybrid", generic: 2, color: Color.White },
  U2: { kind: "monoHybrid", generic: 2, color: Color.Blue },
  B2: { kind: "monoHybrid", generic: 2, color: Color.Black },
  R2: { kind: "monoHybrid", generic: 2, color: Color.Red },
  G2: { kind: "monoHybrid", generic: 2, color: Color.Green },
  // Or colorless (colorless-hybrid)
  CW: { kind: "colorlessHybrid", color: Color.White },
  CU: { kind: "colorlessHybrid", color: Color.Blue },
  CB: { kind: "colorlessHybrid", color: Color.Black },
  CR: { kind: "colorlessHybrid", color: Color.Red },
  CG: { kind: "colorlessHybrid", color: Color.Green },
  // Snow
  S: { kind: "snow" },
  // Phyrexian (single-color)
  WP: { kind: "phyrexian", color: Color.White },
  UP: { kind: "phyrexian", color: Color.Blue },
  BP: { kind: "phyrexian", color: Color.Black },
  RP: { kind: "phyrexian", color: Color.Red },
  GP: { kind: "phyrexian", color: Color.Green },
  // Hybrid phyrexian (two-color). Forge's enum order defines the canonical (a, b).
  BGP: { kind: "hybridPhyrexian", a: Color.Black, b: Color.Green },
  BRP: { kind: "hybridPhyrexian", a: Color.Black, b: Color.Red },
  GUP: { kind: "hybridPhyrexian", a: Color.Green, b: Color.Blue },
  GWP: { kind: "hybridPhyrexian", a: Color.Green, b: Color.White },
  RGP: { kind: "hybridPhyrexian", a: Color.Red, b: Color.Green },
  RWP: { kind: "hybridPhyrexian", a: Color.Red, b: Color.White },
  UBP: { kind: "hybridPhyrexian", a: Color.Blue, b: Color.Black },
  URP: { kind: "hybridPhyrexian", a: Color.Blue, b: Color.Red },
  WBP: { kind: "hybridPhyrexian", a: Color.White, b: Color.Black },
  WUP: { kind: "hybridPhyrexian", a: Color.White, b: Color.Blue },
  // Variable
  X: { kind: "variable", letter: "X" },
  // Colored X (Emblazoned Golem)
  COLORED_X: { kind: "coloredX" },
};

// Maps bit-combinations of color flags (without the P/slash/2 qualifiers) to
// the canonical hybrid-phyrexian enum name. Used by toForgeString().
function hybridPhyrexianNameOf(a: Color, b: Color): string {
  const mask = a | b;
  switch (mask) {
    case Color.Black | Color.Green:
      return "BGP";
    case Color.Black | Color.Red:
      return "BRP";
    case Color.Green | Color.Blue:
      return "GUP";
    case Color.Green | Color.White:
      return "GWP";
    case Color.Red | Color.Green:
      return "RGP";
    case Color.Red | Color.White:
      return "RWP";
    case Color.Blue | Color.Black:
      return "UBP";
    case Color.Blue | Color.Red:
      return "URP";
    case Color.White | Color.Black:
      return "WBP";
    case Color.White | Color.Blue:
      return "WUP";
    default:
      throw new ManaParseError(`Invalid hybridPhyrexian color pair: ${a},${b}`);
  }
}

function hybridNameOf(a: Color, b: Color): string {
  // Forge's hybrid enum uses a fixed order per pair (WU, WB, UB, UR, BR, BG,
  // RW, RG, GW, GU). Compute by mask so that input ordering doesn't matter.
  const mask = a | b;
  switch (mask) {
    case Color.White | Color.Blue:
      return "WU";
    case Color.White | Color.Black:
      return "WB";
    case Color.Blue | Color.Black:
      return "UB";
    case Color.Blue | Color.Red:
      return "UR";
    case Color.Black | Color.Red:
      return "BR";
    case Color.Black | Color.Green:
      return "BG";
    case Color.Red | Color.White:
      return "RW";
    case Color.Red | Color.Green:
      return "RG";
    case Color.Green | Color.White:
      return "GW";
    case Color.Green | Color.Blue:
      return "GU";
    default:
      throw new ManaParseError(`Invalid hybrid color pair: ${a},${b}`);
  }
}

function coloredForgeName(c: Color): string {
  switch (c) {
    case Color.White:
      return "WHITE";
    case Color.Blue:
      return "BLUE";
    case Color.Black:
      return "BLACK";
    case Color.Red:
      return "RED";
    case Color.Green:
      return "GREEN";
    default:
      throw new ManaParseError(`Unknown Color value: ${c as number}`);
  }
}

function monoHybridNameOf(c: Color): string {
  switch (c) {
    case Color.White:
      return "W2";
    case Color.Blue:
      return "U2";
    case Color.Black:
      return "B2";
    case Color.Red:
      return "R2";
    case Color.Green:
      return "G2";
    default:
      throw new ManaParseError(`Unknown color for monoHybrid: ${c as number}`);
  }
}

function phyrexianNameOf(c: Color): string {
  switch (c) {
    case Color.White:
      return "WP";
    case Color.Blue:
      return "UP";
    case Color.Black:
      return "BP";
    case Color.Red:
      return "RP";
    case Color.Green:
      return "GP";
    default:
      throw new ManaParseError(`Unknown color for phyrexian: ${c as number}`);
  }
}

function colorlessHybridNameOf(c: Color): string {
  switch (c) {
    case Color.White:
      return "CW";
    case Color.Blue:
      return "CU";
    case Color.Black:
      return "CB";
    case Color.Red:
      return "CR";
    case Color.Green:
      return "CG";
    default:
      throw new ManaParseError(`Unknown color for colorlessHybrid: ${c as number}`);
  }
}

// --- Contiguous-token parser (forms 1 + 2) ---------------------------------

/**
 * Parse a single symbol starting at position `i` in `input`. Used for both the
 * unbraced contiguous pass and the interior of a single `{...}` group.
 */
function parseOneSymbol(input: string, i: number): { symbol: ManaSymbol; length: number } {
  const ch = input[i];
  if (ch === undefined) {
    throw new ManaParseError("Unexpected end of input while parsing symbol");
  }

  // Guard against stray slashes and unbalanced braces at the token boundary.
  if (ch === "/") {
    throw new ManaParseError(`Stray '/' at position ${i}`);
  }
  if (ch === "{" || ch === "}") {
    throw new ManaParseError(`Unexpected brace at position ${i}`);
  }

  // Numeric generic or monoHybrid left side.
  if (ch >= "0" && ch <= "9") {
    let j = i;
    while (j < input.length) {
      const d = input[j];
      if (d === undefined || d < "0" || d > "9") break;
      j++;
    }
    const digits = input.slice(i, j);
    if (digits.length > 1 && digits.startsWith("0")) {
      throw new ManaParseError(`Numeric token has a leading zero: ${JSON.stringify(digits)}`);
    }
    const amount = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      // WHY: Number.parseInt returns a non-safe float for digit runs > 2^53, so a
      // harmless-looking "999999999999999999999" would silently round. Reject it.
      throw new ManaParseError(`Generic amount is not a safe non-negative integer: ${digits}`);
    }

    // monoHybrid ("2/W")
    if (input[j] === "/") {
      if (amount !== 2) {
        throw new ManaParseError(`Mono-hybrid left side must be 2, got ${amount}`);
      }
      const right = input[j + 1];
      if (right === undefined || !isColorLetter(right)) {
        throw new ManaParseError(`Expected color after "${amount}/" at position ${j + 1}`);
      }
      return {
        symbol: {
          kind: "monoHybrid",
          generic: 2,
          color: colorFromLetter(right),
        },
        length: j + 2 - i,
      };
    }

    return {
      symbol: { kind: "generic", amount },
      length: j - i,
    };
  }

  // Color letter — may be part of hybrid/phyrexian/hybrid-phyrexian/colorless-hybrid.
  if (isColorLetter(ch)) {
    if (input[i + 1] === "/") {
      const right = input[i + 2];
      if (right === undefined) {
        throw new ManaParseError(`Incomplete hybrid: trailing '/' at position ${i + 1}`);
      }
      if (right === "P") {
        // Single-color phyrexian "W/P".
        return {
          symbol: { kind: "phyrexian", color: colorFromLetter(ch) },
          length: 3,
        };
      }
      if (isColorLetter(right)) {
        // Could be hybrid "W/U" OR hybrid-phyrexian "W/U/P" — peek further.
        if (input[i + 3] === "/" && input[i + 4] === "P") {
          return {
            symbol: {
              kind: "hybridPhyrexian",
              a: colorFromLetter(ch),
              b: colorFromLetter(right),
            },
            length: 5,
          };
        }
        return {
          symbol: {
            kind: "hybrid",
            a: colorFromLetter(ch),
            b: colorFromLetter(right),
          },
          length: 3,
        };
      }
      throw new ManaParseError(`Invalid right side of hybrid at position ${i + 2}: ${JSON.stringify(right)}`);
    }
    return {
      symbol: { kind: "colored", color: colorFromLetter(ch) },
      length: 1,
    };
  }

  // Variable letter (X/Y/Z). Only valid on its own — never on the left of '/'.
  if ((VARIABLE_LETTERS as Set<string>).has(ch)) {
    if (input[i + 1] === "/") {
      throw new ManaParseError(`Variable letter cannot be the left side of a hybrid at position ${i}`);
    }
    return {
      symbol: { kind: "variable", letter: ch as "X" | "Y" | "Z" },
      length: 1,
    };
  }

  if (ch === "C") {
    // "C/W" etc. — colorless-hybrid.
    if (input[i + 1] === "/") {
      const right = input[i + 2];
      if (right === undefined || !isColorLetter(right)) {
        throw new ManaParseError(`Expected color after "C/" at position ${i + 2}`);
      }
      return {
        symbol: { kind: "colorlessHybrid", color: colorFromLetter(right) },
        length: 3,
      };
    }
    return { symbol: { kind: "colorless" }, length: 1 };
  }
  if (ch === "S") {
    return { symbol: { kind: "snow" }, length: 1 };
  }

  throw new ManaParseError(`Unknown mana-symbol character ${JSON.stringify(ch)} at position ${i}`);
}

function parseUnbraced(body: string): ManaSymbol[] {
  const out: ManaSymbol[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === undefined) break;
    if (ch === " " || ch === "\t") {
      throw new ManaParseError(`Interior whitespace at position ${i} is not allowed`);
    }
    if (ch === "{" || ch === "}") {
      throw new ManaParseError(`Mixed braced/unbraced form: brace at position ${i}`);
    }
    const { symbol, length } = parseOneSymbol(body, i);
    out.push(symbol);
    i += length;
  }
  return out;
}

function parseBraced(body: string): ManaSymbol[] {
  const out: ManaSymbol[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch !== "{") {
      throw new ManaParseError(`Expected '{' at position ${i}, got ${JSON.stringify(ch)}`);
    }
    const end = body.indexOf("}", i + 1);
    if (end === -1) {
      throw new ManaParseError(`Unclosed '{' starting at position ${i}`);
    }
    const inner = body.slice(i + 1, end);
    if (inner.length === 0) {
      throw new ManaParseError(`Empty braces at position ${i}`);
    }
    if (inner.includes("{")) {
      throw new ManaParseError(`Nested '{' inside braces at position ${i}`);
    }
    const { symbol, length } = parseOneSymbol(inner, 0);
    if (length !== inner.length) {
      throw new ManaParseError(`Trailing characters inside braces: ${JSON.stringify(inner)}`);
    }
    out.push(symbol);
    i = end + 1;
  }
  return out;
}

// --- Space-separated parser (forms 3 + 4) ----------------------------------

// Bit flags mirroring Forge's ManaAtom. Kept internal — callers never see
// these. Values chosen to avoid colliding with Color.{White..Green}.
const ATOM_WHITE = 1 << 0;
const ATOM_BLUE = 1 << 1;
const ATOM_BLACK = 1 << 2;
const ATOM_RED = 1 << 3;
const ATOM_GREEN = 1 << 4;
const ATOM_COLORLESS = 1 << 5;
const ATOM_GENERIC = 1 << 6;
const ATOM_X = 1 << 8;
const ATOM_OR_2_GENERIC = 1 << 9;
const ATOM_OR_2_LIFE = 1 << 10;
const ATOM_SNOW = 1 << 11;

const ATOM_COLOR_BITS = ATOM_WHITE | ATOM_BLUE | ATOM_BLACK | ATOM_RED | ATOM_GREEN;

function atomToColor(atom: number): Color {
  switch (atom) {
    case ATOM_WHITE:
      return Color.White;
    case ATOM_BLUE:
      return Color.Blue;
    case ATOM_BLACK:
      return Color.Black;
    case ATOM_RED:
      return Color.Red;
    case ATOM_GREEN:
      return Color.Green;
    default:
      throw new ManaParseError(`atomToColor: expected a single color bit, got ${atom}`);
  }
}

function popSingleColor(atoms: number): { color: Color; rest: number } {
  const colorMask = atoms & ATOM_COLOR_BITS;
  return { color: atomToColor(colorMask), rest: atoms & ~ATOM_COLOR_BITS };
}

function popTwoColors(atoms: number): { a: Color; b: Color; rest: number } {
  // WHY: order is W-before-U-before-B-before-R-before-G (the ATOM_ bit order,
  // which matches Forge's MagicColor bit ordering). This gives the canonical
  // (a, b) for hybrid / hybridPhyrexian that Forge's enum uses.
  const masks: readonly number[] = [ATOM_WHITE, ATOM_BLUE, ATOM_BLACK, ATOM_RED, ATOM_GREEN];
  const colors: Color[] = [];
  for (const m of masks) {
    if ((atoms & m) !== 0) {
      colors.push(atomToColor(m));
      if (colors.length === 2) break;
    }
  }
  if (colors.length !== 2) {
    throw new ManaParseError(`popTwoColors: expected exactly two color bits, got atoms=${atoms}`);
  }
  const a = colors[0];
  const b = colors[1];
  if (a === undefined || b === undefined) {
    throw new ManaParseError(`popTwoColors: expected exactly two color bits, got atoms=${atoms}`);
  }
  return { a, b, rest: atoms & ~ATOM_COLOR_BITS };
}

/**
 * Parse a single Forge-canonical whitespace-delimited token. Follows Forge's
 * ManaCostShard.parseNonGeneric bit-accumulation logic exactly: iterate each
 * character and OR its atom flag in, ignoring '/' separators; then map the
 * accumulated atom set to a symbol.
 *
 * Numeric tokens (pure digits) are handled at the caller (they count toward
 * the generic cost, not an individual shard — mirrors Forge's parser where
 * Ints.tryParse short-circuits before parseNonGeneric is called).
 */
function parseForgeShardToken(token: string): ManaSymbol {
  let inner = token;
  if (inner.startsWith("{") && inner.endsWith("}")) {
    inner = inner.slice(1, -1);
  } else if (inner.includes("{") || inner.includes("}")) {
    throw new ManaParseError(`Malformed braces in token ${JSON.stringify(token)}`);
  }
  if (inner.length === 0) {
    throw new ManaParseError(`Empty token ${JSON.stringify(token)}`);
  }

  // Accumulate atoms, matching ManaCostShard.parseNonGeneric.
  let atoms = 0;
  let hasGenericDigit = false;
  for (const c of inner) {
    switch (c) {
      case "W":
        atoms |= ATOM_WHITE;
        break;
      case "U":
        atoms |= ATOM_BLUE;
        break;
      case "B":
        atoms |= ATOM_BLACK;
        break;
      case "R":
        atoms |= ATOM_RED;
        break;
      case "G":
        atoms |= ATOM_GREEN;
        break;
      case "P":
        atoms |= ATOM_OR_2_LIFE;
        break;
      case "S":
        atoms |= ATOM_SNOW;
        break;
      case "X":
        atoms |= ATOM_X;
        break;
      case "C":
        atoms |= ATOM_COLORLESS;
        break;
      case "2":
        atoms |= ATOM_OR_2_GENERIC;
        break;
      case "Y":
      case "Z":
        // WHY: Y and Z are our extension beyond Forge (which only has X). We
        // treat them as variables; since there is no atom bit for them, emit
        // them specially when they are the sole token content.
        if (inner !== c) {
          throw new ManaParseError(
            `Variable letter ${c} must be a standalone token, got ${JSON.stringify(token)}`,
          );
        }
        return { kind: "variable", letter: c };
      case "/":
        break; // separator; ignored
      default:
        if (c >= "0" && c <= "9") {
          hasGenericDigit = true;
          atoms |= ATOM_GENERIC;
        } else {
          throw new ManaParseError(
            `Unknown character ${JSON.stringify(c)} in token ${JSON.stringify(token)}`,
          );
        }
        break;
    }
  }

  // If the token was all digits (plus optional "/2"), it's handled elsewhere.
  // Guard anyway in case someone calls this directly with a numeric token.
  if (hasGenericDigit && atoms === ATOM_GENERIC) {
    throw new ManaParseError(`parseForgeShardToken called with pure-numeric token ${JSON.stringify(token)}`);
  }

  // Forge ManaCostShard.parseNonGeneric final normalization:
  //   if atoms == OR_2_GENERIC || atoms == (OR_2_GENERIC | GENERIC) → GENERIC
  // We reject the GENERIC-only case too — pure-numeric tokens are handled
  // outside.
  if (atoms === ATOM_OR_2_GENERIC || atoms === (ATOM_OR_2_GENERIC | ATOM_GENERIC)) {
    throw new ManaParseError(
      `Token ${JSON.stringify(token)} normalizes to generic; use a pure-numeric token instead`,
    );
  }

  // Dispatch by atom pattern to the canonical ManaSymbol kind.
  const isX = (atoms & ATOM_X) !== 0;
  const isSnow = (atoms & ATOM_SNOW) !== 0;
  const isPhyrex = (atoms & ATOM_OR_2_LIFE) !== 0;
  const isOr2Generic = (atoms & ATOM_OR_2_GENERIC) !== 0;
  const isColorless = (atoms & ATOM_COLORLESS) !== 0;
  const colorBits = atoms & ATOM_COLOR_BITS;
  const popCount = (x: number): number => {
    let n = 0;
    let v = x;
    while (v) {
      n += v & 1;
      v >>>= 1;
    }
    return n;
  };

  // Snow — must be solitary S.
  if (isSnow) {
    if (atoms !== ATOM_SNOW) {
      throw new ManaParseError(`Invalid snow token ${JSON.stringify(token)}`);
    }
    return { kind: "snow" };
  }

  // Variable X (potentially COLORED_X — atoms has IS_X + all-five-colors).
  if (isX) {
    // Forge's COLORED_X has atoms = W|U|B|R|G|IS_X. Short-string is "1", so
    // it never arises from text parse; but be safe.
    if (colorBits === ATOM_COLOR_BITS && !isPhyrex && !isOr2Generic && !isColorless) {
      return { kind: "coloredX" };
    }
    if (atoms !== ATOM_X) {
      throw new ManaParseError(`Invalid X token ${JSON.stringify(token)}`);
    }
    return { kind: "variable", letter: "X" };
  }

  // Phyrexian family.
  if (isPhyrex) {
    const nColors = popCount(colorBits);
    if (isColorless || isOr2Generic) {
      throw new ManaParseError(`Invalid phyrexian token ${JSON.stringify(token)}`);
    }
    if (nColors === 1) {
      const { color } = popSingleColor(atoms);
      return { kind: "phyrexian", color };
    }
    if (nColors === 2) {
      const { a, b } = popTwoColors(atoms);
      return { kind: "hybridPhyrexian", a, b };
    }
    throw new ManaParseError(`Invalid phyrexian token ${JSON.stringify(token)}`);
  }

  // Mono-hybrid ("2/W"): OR_2_GENERIC | single color.
  if (isOr2Generic) {
    const nColors = popCount(colorBits);
    if (nColors !== 1 || isColorless) {
      throw new ManaParseError(`Invalid mono-hybrid token ${JSON.stringify(token)}`);
    }
    return { kind: "monoHybrid", generic: 2, color: atomToColor(colorBits) };
  }

  // Colorless-hybrid ("C/W"): COLORLESS | single color.
  if (isColorless && colorBits !== 0) {
    if (popCount(colorBits) !== 1) {
      throw new ManaParseError(`Invalid colorlessHybrid token ${JSON.stringify(token)}`);
    }
    return { kind: "colorlessHybrid", color: atomToColor(colorBits) };
  }

  // Plain colorless "C".
  if (isColorless) {
    return { kind: "colorless" };
  }

  // Plain colored / hybrid by color count.
  const nColors = popCount(colorBits);
  if (nColors === 1) {
    return { kind: "colored", color: atomToColor(colorBits) };
  }
  if (nColors === 2) {
    const { a, b } = popTwoColors(atoms);
    return { kind: "hybrid", a, b };
  }

  throw new ManaParseError(`Unrecognized shard token ${JSON.stringify(token)} (atoms=${atoms})`);
}

function parseSpaceSeparated(body: string): ManaSymbol[] {
  const out: ManaSymbol[] = [];
  const tokens = body.split(/\s+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    // WHY: a token that is (optionally braced) pure digits is a generic amount.
    // We match Forge's ManaCostParser which tries Ints.tryParse first.
    const stripped = tok.startsWith("{") && tok.endsWith("}") ? tok.slice(1, -1) : tok;
    if (/^\d+$/.test(stripped)) {
      const amount = Number.parseInt(stripped, 10);
      if (!Number.isSafeInteger(amount) || amount < 0) {
        // WHY: guard against digit runs that exceed 2^53 and round to a float.
        throw new ManaParseError(`Generic amount is not a safe non-negative integer: ${stripped}`);
      }
      out.push({ kind: "generic", amount });
      continue;
    }
    out.push(parseForgeShardToken(tok));
  }
  return out;
}

// --- ManaCost --------------------------------------------------------------

export interface ManaCostJSON {
  readonly symbols: readonly ManaSymbol[];
  readonly hasNoCost: boolean;
}

export class ManaCost {
  /**
   * Constructs a ManaCost. Prefer {@link ManaCost.parse}, {@link ManaCost.fromJSON},
   * or {@link ManaCost.fromForgeString}.
   *
   * @param symbols  the ordered shard list (empty for {0} and for no-cost)
   * @param hasNoCost  true iff this is Forge's NO_COST (lands, emblems), false
   *                   for every parseable or zero cost. Preserves the Forge
   *                   distinction between {0} and "no cost".
   */
  constructor(
    readonly symbols: readonly ManaSymbol[],
    readonly hasNoCost: boolean = false,
  ) {}

  // ---- Parsing ------------------------------------------------------------

  /**
   * Parse an MTG mana-cost string. Accepts:
   *   - Unbraced Scryfall-style: "2WU"
   *   - Braced Scryfall-style: "{2}{W}{U}"
   *   - Forge canonical whitespace-separated: "2 W U", "X 2 W/P"
   *   - Space-separated + braces: "{2} {W} {U}"
   *
   * An empty string produces a "no cost" ManaCost (hasNoCost=true) — matching
   * Forge's NO_COST. A "0" string produces a zero cost (one generic:0 symbol).
   *
   * Throws {@link ManaParseError} on invalid input, with both the full input
   * and the offending token/position echoed in the message.
   */
  static parse(text: string): ManaCost {
    try {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        // WHY: empty input is our NO_COST analog. Forge reaches NO_COST only
        // via the -1 sentinel in deserialize or via the static NO_COST, but
        // having parse("") also return it is ergonomic for card-data loaders
        // that already normalize blank costs to "".
        return new ManaCost([], true);
      }
      // Any whitespace anywhere in the trimmed input → Forge canonical form.
      if (/\s/.test(trimmed)) {
        return new ManaCost(parseSpaceSeparated(trimmed), false);
      }
      if (trimmed.startsWith("{")) {
        return new ManaCost(parseBraced(trimmed), false);
      }
      return new ManaCost(parseUnbraced(trimmed), false);
    } catch (e) {
      if (e instanceof ManaParseError) {
        throw new ManaParseError(`Failed to parse mana cost ${JSON.stringify(text)}: ${e.message}`);
      }
      throw e;
    }
  }

  // ---- Forge wire-format bridge ------------------------------------------

  /**
   * Parse Forge's ManaCost.serialize() wire format, which uses ASCII 0x06 as
   * the delimiter. The first token is the generic count ("-1" for no-cost);
   * remaining tokens are ManaCostShard enum .name() strings like "WHITE",
   * "WU", "CW", "WP", "WUP", "X", "S", "COLORED_X".
   */
  static fromForgeString(s: string): ManaCost {
    if (s.length === 0) {
      // WHY: Forge's serialize() never emits "" (NO_COST serializes as "-1"),
      // but tolerate it as our empty-input convention.
      return new ManaCost([], true);
    }
    const pieces = s.split(FORGE_DELIM);
    const headRaw = pieces[0];
    if (headRaw === undefined) {
      throw new ManaParseError(`fromForgeString: empty input after split: ${JSON.stringify(s)}`);
    }
    const genericRaw = headRaw;
    const generic = Number.parseInt(genericRaw, 10);
    if (!Number.isFinite(generic)) {
      throw new ManaParseError(
        `fromForgeString: expected numeric head, got ${JSON.stringify(genericRaw)} in ${JSON.stringify(s)}`,
      );
    }
    const hasNoCost = generic < 0;

    const syms: ManaSymbol[] = [];
    if (!hasNoCost && generic > 0) {
      syms.push({ kind: "generic", amount: generic });
    }
    for (let i = 1; i < pieces.length; i++) {
      const name = pieces[i];
      if (name === undefined || name.length === 0) continue; // WHY: tolerant against stray delimiters
      // GENERIC is never written by Forge's serialize (the numeric prefix owns
      // it) but guard against it anyway.
      if (name === "GENERIC") continue;
      const sym = FORGE_NAME_TO_SYMBOL[name];
      if (sym === undefined) {
        throw new ManaParseError(
          `fromForgeString: unknown shard name ${JSON.stringify(name)} in ${JSON.stringify(s)}`,
        );
      }
      syms.push(sym);
    }
    return new ManaCost(syms, hasNoCost);
  }

  /**
   * Emit Forge's ManaCost.serialize() wire format. Numeric generic amounts are
   * summed into the prefix (matching Forge's behavior of collapsing GENERIC
   * shards into genericCost). All other shards are written by their canonical
   * Forge enum .name(), delimited by ASCII 0x06.
   */
  toForgeString(): string {
    if (this.hasNoCost) {
      // Forge: builder.append(mc.hasNoCost ? -1 : mc.genericCost) → "-1"
      return "-1";
    }
    let generic = 0;
    const names: string[] = [];
    for (const s of this.symbols) {
      switch (s.kind) {
        case "generic":
          generic += s.amount;
          break;
        case "variable":
          // WHY: Forge only encodes X. Y and Z are our extension — we flatten
          // them to X for wire-format purposes (they round-trip to X on read).
          names.push("X");
          break;
        case "colored":
          names.push(coloredForgeName(s.color));
          break;
        case "colorless":
          names.push("COLORLESS");
          break;
        case "snow":
          names.push("S");
          break;
        case "hybrid":
          names.push(hybridNameOf(s.a, s.b));
          break;
        case "monoHybrid":
          names.push(monoHybridNameOf(s.color));
          break;
        case "phyrexian":
          names.push(phyrexianNameOf(s.color));
          break;
        case "colorlessHybrid":
          names.push(colorlessHybridNameOf(s.color));
          break;
        case "hybridPhyrexian":
          names.push(hybridPhyrexianNameOf(s.a, s.b));
          break;
        case "coloredX":
          names.push("COLORED_X");
          break;
        default: {
          const _exhaustive: never = s;
          throw new Error(`Unhandled ManaSymbol kind: ${(_exhaustive as ManaSymbol).kind}`);
        }
      }
    }
    return names.length === 0 ? String(generic) : `${generic}${FORGE_DELIM}${names.join(FORGE_DELIM)}`;
  }

  // ---- CMC / color helpers -----------------------------------------------

  /**
   * Converted mana cost / mana value.
   *
   * TODO(Task 14+): today all X/Y/Z symbols share a single caller-supplied
   * value. Casting modes where X and Y differ (Rise of the Dark Realms, etc.)
   * will need a richer substitution map. For now this mirrors Forge's default
   * behavior and avoids premature generalization.
   */
  cmc(xValue = 0): ManaValue {
    if (!Number.isInteger(xValue) || xValue < 0) {
      // WHY: cmc sums xValue into an integer ManaValue; NaN/negative/non-integer
      // produce nonsense totals that quietly propagate into downstream rules.
      throw new RangeError(`cmc xValue must be a non-negative integer, got: ${xValue}`);
    }
    let total = 0;
    for (const s of this.symbols) {
      switch (s.kind) {
        case "generic":
          total += s.amount;
          break;
        case "variable":
          total += xValue;
          break;
        case "coloredX":
          // WHY: COLORED_X is a variable too (IS_X flag) and Forge's getCmc
          // returns 0 for IS_X shards; the caller supplies xValue here.
          total += xValue;
          break;
        case "colored":
        case "colorless":
        case "snow":
        case "hybrid":
        case "phyrexian":
        case "colorlessHybrid":
        case "hybridPhyrexian":
          total += 1;
          break;
        case "monoHybrid":
          total += 2;
          break;
        default: {
          const _exhaustive: never = s;
          throw new Error(`Unhandled ManaSymbol kind: ${(_exhaustive as ManaSymbol).kind}`);
        }
      }
    }
    return total;
  }

  /**
   * Union of colors contributed by this cost's colored/hybrid variants.
   * Generic, variable, coloredX, colorless and snow contribute none. For
   * colorlessHybrid only the color alternative contributes (the C is not a
   * color). For phyrexian/hybridPhyrexian the life-payment alternative is
   * not a color but the color(s) always are.
   */
  colors(): ColorSet {
    const colors: Color[] = [];
    for (const s of this.symbols) {
      switch (s.kind) {
        case "colored":
        case "monoHybrid":
        case "phyrexian":
        case "colorlessHybrid":
          colors.push(s.color);
          break;
        case "hybrid":
        case "hybridPhyrexian":
          colors.push(s.a, s.b);
          break;
        case "generic":
        case "variable":
        case "coloredX":
        case "colorless":
        case "snow":
          break;
        default: {
          const _exhaustive: never = s;
          throw new Error(`Unhandled ManaSymbol kind: ${(_exhaustive as ManaSymbol).kind}`);
        }
      }
    }
    return colors.length === 0 ? ColorSet.empty() : ColorSet.of(...colors);
  }

  // ---- Forge-ported predicates -------------------------------------------

  /**
   * True for Forge's NO_COST. Distinct from {@link isZero} ("{0}"): a zero
   * cost still has one generic:0 symbol, while a no-cost has zero symbols and
   * the hasNoCost flag set.
   */
  isNoCost(): boolean {
    return this.hasNoCost;
  }

  /**
   * True for "{0}" — mana value zero but explicitly payable. Forge:
   *   genericCost == 0 && isPureGeneric() (which requires !hasNoCost).
   *
   * Our encoding: total cmc is 0 AND at least one symbol exists AND all
   * symbols are generic AND !hasNoCost. Accepts both the canonical single
   * {generic:0} and oddities like "{0}{0}" that parse to multiple generic:0.
   */
  isZero(): boolean {
    if (this.hasNoCost) return false;
    if (this.symbols.length === 0) return false;
    for (const s of this.symbols) {
      if (s.kind !== "generic") return false;
      if (s.amount !== 0) return false;
    }
    return true;
  }

  /**
   * True iff every symbol is kind "generic" and this is not a no-cost. Matches
   * Forge's ManaCost.isPureGeneric (shards.isEmpty && !hasNoCost, where shards
   * excludes GENERIC by convention).
   */
  isPureGeneric(): boolean {
    if (this.hasNoCost) return false;
    for (const s of this.symbols) {
      if (s.kind !== "generic") return false;
    }
    return true;
  }

  /**
   * Sum of plain generic amounts in this cost. Hybrid, mono-hybrid, phyrexian,
   * colorless, variable, etc. do NOT contribute. Mirrors Forge's genericCost
   * field (which stores the running total before other shards are added).
   */
  genericCost(): number {
    let n = 0;
    for (const s of this.symbols) {
      if (s.kind === "generic") n += s.amount;
    }
    return n;
  }

  /** Number of X/Y/Z symbols in the cost (each letter instance = 1). */
  countX(): number {
    let n = 0;
    for (const s of this.symbols) {
      if (s.kind === "variable" || s.kind === "coloredX") n++;
    }
    return n;
  }

  /** True iff any symbol is phyrexian or hybrid-phyrexian. */
  hasPhyrexian(): boolean {
    for (const s of this.symbols) {
      if (s.kind === "phyrexian" || s.kind === "hybridPhyrexian") return true;
    }
    return false;
  }

  /** Count of phyrexian + hybrid-phyrexian symbols. */
  getPhyrexianCount(): number {
    let n = 0;
    for (const s of this.symbols) {
      if (s.kind === "phyrexian" || s.kind === "hybridPhyrexian") n++;
    }
    return n;
  }

  /**
   * True iff the cost has any two-color shard. Mirrors Forge's hasMultiColor,
   * which walks shards and returns any shard.isMultiColor (bit-count 2).
   */
  hasMultiColor(): boolean {
    for (const s of this.symbols) {
      if (s.kind === "hybrid" || s.kind === "hybridPhyrexian") return true;
    }
    return false;
  }

  /**
   * Count of symbols whose discriminant matches `kind`. For "generic", this
   * returns the number of generic *symbols* present (not the summed amount —
   * use {@link genericCost} for that).
   */
  shardCount(kind: ManaSymbol["kind"]): number {
    let n = 0;
    for (const s of this.symbols) {
      if (s.kind === kind) n++;
    }
    return n;
  }

  // ---- Combinators -------------------------------------------------------

  /**
   * Concatenate two costs. Mirrors Forge's ManaCost.combine, which keeps
   * individual generic amounts as separate shards but adds a fresh combined
   * genericCost to the new instance. Our encoding stores generic as a symbol
   * already, so we just concatenate (Forge's resulting toString collapses
   * duplicate generics via getSimpleString which sums them; we preserve them
   * verbatim so the operation is associative).
   *
   * If either input is a no-cost (hasNoCost), the result is NOT a no-cost
   * (combining a no-cost with any real cost yields a real cost — Forge's
   * combine always produces a cost with hasNoCost=false via the int ctor).
   */
  static combine(a: ManaCost, b: ManaCost): ManaCost {
    return new ManaCost([...a.symbols, ...b.symbols], false);
  }

  // ---- JSON -------------------------------------------------------------

  toJSON(): ManaCostJSON {
    return { symbols: [...this.symbols], hasNoCost: this.hasNoCost };
  }

  /**
   * Accepts both the new JSON shape ({symbols, hasNoCost}) and the legacy
   * shape ({symbols}) for backward compatibility with data written before the
   * hasNoCost flag existed. Missing hasNoCost defaults to false.
   */
  static fromJSON(s: ManaCostJSON | { symbols: ManaSymbol[] }): ManaCost {
    const hasNoCost = "hasNoCost" in s ? s.hasNoCost : false;
    return new ManaCost([...s.symbols], hasNoCost);
  }
}

/**
 * Free-function helper mirroring {@link ManaCost.cmc}. Useful when callers want
 * to hand a cost to a generic numeric-evaluator pipeline.
 */
export function manaValue(cost: ManaCost, x = 0): ManaValue {
  return cost.cmc(x);
}

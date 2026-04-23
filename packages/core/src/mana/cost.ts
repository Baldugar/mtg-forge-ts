// SPDX-License-Identifier: GPL-3.0-or-later
// ManaCost — immutable value object representing a parsed mana-cost string.
// Tokenizer accepts either the unbraced Scryfall-style form ("2WU", "W/U",
// "2/W", "W/P", "X", "10", "C", "S") or a fully-braced form ("{2}{W}{U}").
// If the input begins with "{" all symbols MUST be braced; otherwise none may
// be. This avoids ambiguity with strings like "{W}U" where a partial brace is
// neither obviously one form nor the other.

import { Color, ColorSet } from "../color.js";
import { ManaParseError, type ManaSymbol } from "./symbol.js";

/** Mana value (Magic's rules-defined "converted mana cost"). */
export type ManaValue = number;

// --- Internal helpers -------------------------------------------------------

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

/**
 * Parse a single symbol from the unbraced stream starting at `i`.
 * Returns the parsed symbol and the number of characters consumed.
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
    // Read a run of digits.
    let j = i;
    while (j < input.length) {
      const d = input[j];
      if (d === undefined || d < "0" || d > "9") break;
      j++;
    }
    const digits = input.slice(i, j);
    // Reject leading zeros except for the literal "0".
    if (digits.length > 1 && digits.startsWith("0")) {
      throw new ManaParseError(`Numeric token has a leading zero: ${JSON.stringify(digits)}`);
    }
    const amount = Number.parseInt(digits, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new ManaParseError(`Invalid generic amount: ${digits}`);
    }

    // Check for monoHybrid ("2/W"): only amount === 2 is valid MTG-wise.
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

  // Color letter — may be part of a hybrid ("W/U") or phyrexian ("W/P"), or
  // standalone ("W").
  if (isColorLetter(ch)) {
    if (input[i + 1] === "/") {
      const right = input[i + 2];
      if (right === undefined) {
        throw new ManaParseError(`Incomplete hybrid: trailing '/' at position ${i + 1}`);
      }
      if (right === "P") {
        return {
          symbol: { kind: "phyrexian", color: colorFromLetter(ch) },
          length: 3,
        };
      }
      if (isColorLetter(right)) {
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

// --- ManaCost --------------------------------------------------------------

export class ManaCost {
  constructor(readonly symbols: readonly ManaSymbol[]) {}

  /**
   * Parse an MTG mana-cost string in either unbraced (`"2WU"`) or fully-braced
   * (`"{2}{W}{U}"`) form. Leading/trailing whitespace is trimmed; interior
   * whitespace is rejected. Throws {@link ManaParseError} on invalid input.
   */
  static parse(text: string): ManaCost {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return new ManaCost([]);
    }
    // Reject stray close-braces even in the unbraced branch.
    if (trimmed.startsWith("{")) {
      return new ManaCost(parseBraced(trimmed));
    }
    return new ManaCost(parseUnbraced(trimmed));
  }

  /**
   * Converted mana cost / mana value.
   *
   * TODO(Task 14+): today all X/Y/Z symbols share a single caller-supplied
   * value. Casting modes where X and Y differ (Rise of the Dark Realms, etc.)
   * will need a richer substitution map. For now this mirrors Forge's default
   * behavior and avoids premature generalization.
   */
  cmc(xValue = 0): ManaValue {
    let total = 0;
    for (const s of this.symbols) {
      switch (s.kind) {
        case "generic":
          total += s.amount;
          break;
        case "variable":
          total += xValue;
          break;
        case "colored":
        case "colorless":
        case "snow":
        case "hybrid":
        case "phyrexian":
          total += 1;
          break;
        case "monoHybrid":
          total += 2;
          break;
      }
    }
    return total;
  }

  /**
   * Union of colors contributed by this cost's colored/hybrid/monoHybrid/
   * phyrexian symbols. Generic, variable, colorless and snow contribute none.
   */
  colors(): ColorSet {
    const colors: Color[] = [];
    for (const s of this.symbols) {
      switch (s.kind) {
        case "colored":
        case "monoHybrid":
        case "phyrexian":
          colors.push(s.color);
          break;
        case "hybrid":
          colors.push(s.a, s.b);
          break;
        case "generic":
        case "variable":
        case "colorless":
        case "snow":
          break;
      }
    }
    return colors.length === 0 ? ColorSet.empty() : ColorSet.of(...colors);
  }

  toJSON(): { symbols: ManaSymbol[] } {
    return { symbols: [...this.symbols] };
  }

  static fromJSON(s: { symbols: ManaSymbol[] }): ManaCost {
    return new ManaCost(s.symbols);
  }
}

/**
 * Free-function helper mirroring {@link ManaCost.cmc}. Useful when callers want
 * to hand a cost to a generic numeric-evaluator pipeline.
 */
export function manaValue(cost: ManaCost, x = 0): ManaValue {
  return cost.cmc(x);
}

// SPDX-License-Identifier: GPL-3.0-or-later
// ManaCost line parser. Delegates symbol parsing to ManaCost.parse() from
// core, which handles space-separated Forge format ("2 W U"), braced Scryfall
// format ("{2}{W}{U}"), and contiguous form ("2WU"). The sentinels "no cost",
// "0", and "" are treated as zero-cost (empty symbols array) per Forge's
// "no cost" card field convention.

import { ManaCost } from "@mtg-forge-ts/core";
import type { ManaCostAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const NO_COST_SENTINELS = new Set(["no cost", "0", ""]);

export const parseManaCostLine = (line: LexedLine): ManaCostAst => {
  if (line.prefix !== "ManaCost") {
    throw new Error(`expected prefix 'ManaCost', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const raw = line.content;
  if (NO_COST_SENTINELS.has(raw.toLowerCase())) {
    return { raw, symbols: [] };
  }
  const parsed = ManaCost.parse(raw);
  return { raw, symbols: parsed.symbols };
};

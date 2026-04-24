// SPDX-License-Identifier: GPL-3.0-or-later
// Colors line parser. Converts the comma-or-space-delimited color name list
// on a "Colors:" line into a ColorSet bitmask. ColorSet is a class from core
// (Color enum bits: W=1, U=2, B=4, R=8, G=16) — NOT a plain {W,U,B,R,G} object.

import { Color, ColorSet } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const NAME_TO_COLOR: Record<string, Color> = {
  white: Color.White,
  w: Color.White,
  blue: Color.Blue,
  u: Color.Blue,
  black: Color.Black,
  b: Color.Black,
  red: Color.Red,
  r: Color.Red,
  green: Color.Green,
  g: Color.Green,
};

export const parseColorsLine = (line: LexedLine): ColorSet => {
  if (line.prefix !== "Colors") {
    throw new Error(`expected prefix 'Colors' at line ${line.lineNumber}`);
  }
  if (line.content.trim().toLowerCase() === "colorless") return ColorSet.empty();
  const colors: Color[] = [];
  for (const tok of line.content.split(/[,\s]+/).filter((s) => s !== "")) {
    const color = NAME_TO_COLOR[tok.toLowerCase()];
    if (color === undefined) throw new Error(`unknown color '${tok}' at line ${line.lineNumber}`);
    colors.push(color);
  }
  return ColorSet.of(...colors);
};

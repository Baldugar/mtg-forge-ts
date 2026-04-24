// SPDX-License-Identifier: GPL-3.0-or-later
import type { DefenseAst, LoyaltyAst, PtAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

export const parsePtLine = (line: LexedLine): PtAst => {
  if (line.prefix !== "PT") {
    throw new Error(`expected prefix 'PT', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const slash = line.content.indexOf("/");
  if (slash < 0) {
    throw new Error(`parsePtLine: missing '/' in '${line.content}' at line ${line.lineNumber}`);
  }
  return {
    power: line.content.slice(0, slash).trim(),
    toughness: line.content.slice(slash + 1).trim(),
  };
};

export const parseLoyaltyLine = (line: LexedLine): LoyaltyAst => {
  if (line.prefix !== "Loyalty") {
    throw new Error(`expected prefix 'Loyalty' at line ${line.lineNumber}`);
  }
  return { starting: line.content.trim() };
};

export const parseDefenseLine = (line: LexedLine): DefenseAst => {
  if (line.prefix !== "Defense") {
    throw new Error(`expected prefix 'Defense' at line ${line.lineNumber}`);
  }
  return { starting: line.content.trim() };
};

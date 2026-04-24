// SPDX-License-Identifier: GPL-3.0-or-later
// Passthrough line parsers: Name, Oracle, Text, Rules, AI, DeckHas,
// DeckHints, DeckNeeds. The first four return the line's free-text
// content string; the AI+Deck family return a flattened key→value map
// of the $-split tokens on the line.

import type { LexedLine } from "./lexer.js";

const str = (line: LexedLine, expected: string): string => {
  if (line.prefix !== expected) {
    throw new Error(`expected prefix '${expected}', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  return line.content;
};

const flatTokens = (line: LexedLine): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const tok of line.tokens) {
    for (const [k, v] of tok) out.set(k, v);
  }
  return out;
};

export const parseNameLine = (line: LexedLine): string => str(line, "Name");
export const parseOracleLine = (line: LexedLine): string => str(line, "Oracle");
export const parseTextLine = (line: LexedLine): string => str(line, "Text");
export const parseRulesLine = (line: LexedLine): string => str(line, "Rules");
export const parseAiHintLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
export const parseDeckHasLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
export const parseDeckHintsLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);
export const parseDeckNeedsLine = (line: LexedLine): ReadonlyMap<string, string> => flatTokens(line);

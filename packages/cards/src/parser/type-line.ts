// SPDX-License-Identifier: GPL-3.0-or-later
import type { TypeLineAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Elite", "Ongoing", "Host"]);
const TYPES = new Set([
  "Artifact",
  "Creature",
  "Enchantment",
  "Instant",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Battle",
  "Tribal",
  "Conspiracy",
  "Phenomenon",
  "Plane",
  "Scheme",
  "Vanguard",
  "Dungeon",
  "Kindred",
]);

export const parseTypeLine = (line: LexedLine): TypeLineAst => {
  if (line.prefix !== "Types") {
    throw new Error(`expected prefix 'Types', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const tokens = line.content.split(/\s+/).filter((s) => s !== "");
  const supertypes: string[] = [];
  const types: string[] = [];
  const subtypes: string[] = [];
  for (const t of tokens) {
    if (SUPERTYPES.has(t)) supertypes.push(t);
    else if (TYPES.has(t)) types.push(t);
    else subtypes.push(t);
  }
  return { supertypes, types, subtypes };
};

// SPDX-License-Identifier: GPL-3.0-or-later
// AST assembler — takes raw card .txt source, lexes it, dispatches each
// line to its per-prefix parser, and accumulates a CardDefinition. No
// runtime handler dispatch — this produces pure AST data.
//
// Stage 3 of the five-stage parser pipeline (lexer → line parsers →
// assembler → resolver → CardDefinition).

import {
  type AbilityAst,
  type CardDefinition,
  type CardType,
  type ColorSet,
  type DefenseAst,
  type KeywordAst,
  type LoyaltyAst,
  type ManaCostAst,
  type PtAst,
  type ReplacementAst,
  type SVarAst,
  type StaticAst,
  type Supertype,
  type TriggerAst,
  TypeLine,
  type TypeLineAst,
} from "@mtg-forge-ts/core";
import { parseAbilityLine } from "./ability-line.js";
import { parseColorsLine } from "./colors-line.js";
import { parseKeywordLine } from "./keyword-line.js";
import { type LexedLine, lex } from "./lexer.js";
import { parseManaCostLine } from "./mana-cost-line.js";
import { parseDefenseLine, parseLoyaltyLine, parsePtLine } from "./pt-loyalty-defense.js";
import { parseReplacementLine } from "./replacement-line.js";
import { resolveReferences } from "./resolver.js";
import {
  parseAiHintLine,
  parseDeckHasLine,
  parseDeckHintsLine,
  parseDeckNeedsLine,
  parseNameLine,
  parseOracleLine,
  parseRulesLine,
  parseTextLine,
} from "./simple-lines.js";
import { parseStaticLine } from "./static-line.js";
import { parseSVarLine } from "./svar-line.js";
import { parseTriggerLine } from "./trigger-line.js";
import { parseTypeLine } from "./type-line.js";

// Map from TypeLineAst (raw string arrays) to TypeLine class (enum arrays).
// TypeLineAst supertypes/types use the same string values as the enum keys,
// so we can cast safely via the string-enum identity.
const typeLineAstToTypeLine = (ast: TypeLineAst): TypeLine => {
  const supertypes = ast.supertypes as readonly Supertype[];
  const types = ast.types as readonly CardType[];
  return new TypeLine(supertypes, types, ast.subtypes);
};

interface AssemblerState {
  name: string | null;
  manaCost: ManaCostAst | null;
  colors: ColorSet | null;
  types: TypeLineAst | null;
  pt: PtAst | null;
  loyalty: LoyaltyAst | null;
  defense: DefenseAst | null;
  abilities: AbilityAst[];
  triggers: TriggerAst[];
  replacements: ReplacementAst[];
  statics: StaticAst[];
  keywords: KeywordAst[];
  svars: Map<string, SVarAst>;
  aiHints: ReadonlyMap<string, string>[];
  oracle: string;
  rulesText: string;
}

const freshState = (): AssemblerState => ({
  name: null,
  manaCost: null,
  colors: null,
  types: null,
  pt: null,
  loyalty: null,
  defense: null,
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
  aiHints: [],
  oracle: "",
  rulesText: "",
});

const dispatch = (line: LexedLine, st: AssemblerState): void => {
  switch (line.prefix) {
    case "Name":
      st.name = parseNameLine(line);
      break;
    case "ManaCost":
      st.manaCost = parseManaCostLine(line);
      break;
    case "Colors":
      st.colors = parseColorsLine(line);
      break;
    case "Types":
      st.types = parseTypeLine(line);
      break;
    case "PT":
      st.pt = parsePtLine(line);
      break;
    case "Loyalty":
      st.loyalty = parseLoyaltyLine(line);
      break;
    case "Defense":
      st.defense = parseDefenseLine(line);
      break;
    case "A":
      st.abilities.push(parseAbilityLine(line));
      break;
    case "T":
      st.triggers.push(parseTriggerLine(line));
      break;
    case "R":
      st.replacements.push(parseReplacementLine(line));
      break;
    case "S":
      st.statics.push(...parseStaticLine(line));
      break;
    case "K":
      st.keywords.push(parseKeywordLine(line));
      break;
    case "SVar": {
      const { name, ast } = parseSVarLine(line);
      st.svars.set(name, ast);
      break;
    }
    case "AI":
      st.aiHints.push(parseAiHintLine(line));
      break;
    case "DeckHas":
      st.aiHints.push(parseDeckHasLine(line));
      break;
    case "DeckHints":
      st.aiHints.push(parseDeckHintsLine(line));
      break;
    case "DeckNeeds":
      st.aiHints.push(parseDeckNeedsLine(line));
      break;
    case "Oracle":
      st.oracle = parseOracleLine(line);
      break;
    case "Text": {
      const t = parseTextLine(line);
      st.rulesText = st.rulesText === "" ? t : `${st.rulesText}\n${t}`;
      break;
    }
    case "Rules": {
      const t = parseRulesLine(line);
      st.rulesText = st.rulesText === "" ? t : `${st.rulesText}\n${t}`;
      break;
    }
    case "AlternateMode":
      // Handled by the multi-face split at the top level; no-op here.
      break;
    case "HandLifeModifier":
      // Commander-specific metadata; noop for parser.
      break;
    case "Variant":
    case "Draft":
    case "Schemes":
      // Wave 7: tolerated metadata prefixes. These carry adventure/draft/scheme
      // side-data that the engine does not yet act on at parse time. Silently
      // ignore so corpus cards with these lines parse cleanly.
      break;
    default:
      throw new Error(`unknown prefix '${line.prefix}' at line ${line.lineNumber}`);
  }
};

const finalizeDefinition = (st: AssemblerState, file: string): CardDefinition => {
  if (st.name === null) throw new Error(`${file}: missing Name: line`);
  if (st.types === null) throw new Error(`${file}: face '${st.name}' missing Types: line`);
  return {
    name: st.name,
    oracle: st.oracle,
    types: typeLineAstToTypeLine(st.types),
    manaCost: st.manaCost,
    ...(st.pt ? { pt: { power: st.pt.power, toughness: st.pt.toughness } } : {}),
    ...(st.loyalty ? { loyalty: st.loyalty.starting } : {}),
    ...(st.defense ? { defense: st.defense.starting } : {}),
    ...(st.colors ? { colors: st.colors } : {}),
    abilities: st.abilities,
    triggers: st.triggers,
    replacements: st.replacements,
    statics: st.statics,
    keywords: st.keywords,
    svars: st.svars,
  };
};

export const parseCard = (source: string, file: string): CardDefinition => {
  const allLines = lex(source);
  const sections: LexedLine[][] = [[]];
  for (const line of allLines) {
    // Bare "ALTERNATE" is lexed as AlternateMode with empty content and is
    // the actual multi-face separator. AlternateMode:DoubleFaced / :Split /
    // :Specialize etc. with non-empty content are card-level metadata and go
    // into the current section (dispatch handles them as no-ops).
    if (line.prefix === "AlternateMode" && line.content === "") {
      sections.push([]);
    } else {
      const current = sections[sections.length - 1];
      if (current) current.push(line);
    }
  }
  const parseSection = (linesInSection: readonly LexedLine[]): CardDefinition => {
    const st = freshState();
    for (const line of linesInSection) dispatch(line, st);
    return finalizeDefinition(st, file);
  };
  const firstSection = sections[0];
  if (!firstSection) throw new Error(`${file}: empty card file`);
  const primary = parseSection(firstSection);
  const result = sections.length === 1 ? primary : { ...primary, faces: sections.slice(1).map(parseSection) };
  resolveReferences(result);
  return result;
};

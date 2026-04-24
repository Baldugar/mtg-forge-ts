// SPDX-License-Identifier: GPL-3.0-or-later
import {
  type KeywordAst,
  type KeywordId,
  type ParamValue,
  keywordIdFromDisplayName,
} from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

// Keywords whose parameter slot name is "cost"
const COST_KEYWORDS: ReadonlySet<string> = new Set([
  "kicker",
  "multikicker",
  "bestow",
  "buyback",
  "cycling",
  "dash",
  "disturb",
  "echo",
  "embalm",
  "emerge",
  "entwine",
  "eternalize",
  "escape",
  "evoke",
  "fortify",
  "flashback",
  "foretell",
  "freerunning",
  "harmonize",
  "level_up",
  "madness",
  "mayhem",
  "megamorph",
  "miracle",
  "more_than_meets_the_eye",
  "morph",
  "ninjutsu",
  "outlast",
  "overload",
  "plot",
  "prototype",
  "prowl",
  "reconfigure",
  "reflect",
  "scavenge",
  "specialize",
  "spectacle",
  "squad",
  "surge",
  "transfigure",
  "transmute",
  "unearth",
  "ward",
  "warp",
  "web_slinging",
  "cumulative_upkeep",
  "aura_swap",
  "equip",
  "disguise",
]);

// Keywords whose parameter slot name is "amount"
const AMOUNT_KEYWORDS: ReadonlySet<string> = new Set([
  "absorb",
  "afflict",
  "afterlife",
  "annihilator",
  "awaken",
  "backup",
  "bloodthirst",
  "bushido",
  "casualty",
  "crew",
  "dredge",
  "fabricate",
  "fading",
  "frenzy",
  "graft",
  "hideaway",
  "mobilize",
  "poisonous",
  "rampage",
  "reinforce",
  "renown",
  "ripple",
  "saddle",
  "soulshift",
  "station",
  "toxic",
  "tribute",
  "vanishing",
  "impending",
]);

// Keywords whose parameter slot name is "type"
const TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  "bands_with_other",
  "champion",
  "enchant",
  "landwalk",
  "offering",
  "partner_with",
  "typecycling",
]);

const resolveKeywordId = (raw: string, lineNumber: number): KeywordId => {
  // Try direct display name lookup (handles "Flying", "First Strike", "Jump-start", etc.)
  const byDisplay = keywordIdFromDisplayName(raw);
  if (byDisplay !== null) return byDisplay;
  // Try replacing underscores with spaces (for snake_case input)
  const normalized = raw.replace(/_/g, " ");
  const byNorm = keywordIdFromDisplayName(normalized);
  if (byNorm !== null) return byNorm;
  throw new Error(`unknown keyword '${raw}' at line ${lineNumber}`);
};

export const parseKeywordLine = (line: LexedLine): KeywordAst => {
  if (line.prefix !== "K") {
    throw new Error(`parseKeywordLine: expected prefix 'K', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const raw = line.content;
  const colonIdx = raw.indexOf(":");
  if (colonIdx < 0) {
    // No colon — simple keyword with no param
    const keyword = resolveKeywordId(raw, line.lineNumber);
    return { keyword };
  }
  const head = raw.slice(0, colonIdx).trim();
  const tail = raw.slice(colonIdx + 1).trim();
  const keyword = resolveKeywordId(head, line.lineNumber);

  const paramValue: ParamValue = { kind: "literal", raw: tail };
  let paramKey: string;
  if (COST_KEYWORDS.has(keyword)) {
    paramKey = "cost";
  } else if (AMOUNT_KEYWORDS.has(keyword)) {
    paramKey = "amount";
  } else if (TYPE_KEYWORDS.has(keyword)) {
    paramKey = "type";
  } else {
    paramKey = "detail";
  }

  return { keyword, params: { [paramKey]: paramValue } };
};

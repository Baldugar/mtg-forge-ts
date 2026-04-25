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

// Matches "Protection from <something>" — maps to the canonical "protection"
// keyword id with the qualifier stored in params.from.
const PROTECTION_FROM_RE = /^protection from (.+)$/i;

const resolveKeywordId = (raw: string): KeywordId => {
  // Try direct display name lookup (handles "Flying", "First Strike", "Jump-start", etc.)
  const byDisplay = keywordIdFromDisplayName(raw);
  if (byDisplay !== null) return byDisplay;
  // Try replacing underscores with spaces (for snake_case input)
  const normalized = raw.replace(/_/g, " ");
  const byNorm = keywordIdFromDisplayName(normalized);
  if (byNorm !== null) return byNorm;
  // Fall back to freeform — unknown keywords are tolerated as opaque text.
  return "freeform" as KeywordId;
};

export const parseKeywordLine = (line: LexedLine): KeywordAst => {
  if (line.prefix !== "K") {
    throw new Error(`parseKeywordLine: expected prefix 'K', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const raw = line.content;

  // Special-case: "Protection from <X>" — map to canonical "protection" keyword.
  const protectionMatch = PROTECTION_FROM_RE.exec(raw);
  if (protectionMatch) {
    return {
      keyword: "protection" as KeywordId,
      params: { from: { kind: "literal", raw: protectionMatch[1] ?? "" } },
    };
  }

  const colonIdx = raw.indexOf(":");
  if (colonIdx < 0) {
    // No colon — simple keyword with no param
    const keyword = resolveKeywordId(raw);
    if (keyword === ("freeform" as KeywordId)) {
      return { keyword, params: { text: { kind: "literal", raw } } };
    }
    return { keyword };
  }
  const head = raw.slice(0, colonIdx).trim();
  const tail = raw.slice(colonIdx + 1).trim();
  const keyword = resolveKeywordId(head);

  if (keyword === ("freeform" as KeywordId)) {
    // Freeform keyword — store the full raw text.
    return { keyword, params: { text: { kind: "literal", raw } } };
  }

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

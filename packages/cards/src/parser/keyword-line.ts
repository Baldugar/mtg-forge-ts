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

// Keywords with two parameter slots — `K:Suspend:N:cost` parses to
// { amount: N, cost: <rest> }. The split is at the FIRST inner colon (after
// the keyword head colon already consumed). Any further colons stay in the
// cost string, which is consistent with how mana costs allow multi-segment
// raw forms (e.g. "1 R").
const TWO_PARAM_KEYWORDS: ReadonlyMap<string, readonly [string, string]> = new Map([
  // Suspend N — <cost>: N time counters at exile time, mana cost paid at
  // suspend time. CR 702.61.
  ["suspend", ["amount", "cost"]],
]);

// Matches "Protection from <something>" — maps to the canonical "protection"
// keyword id with the qualifier stored in params.from.
const PROTECTION_FROM_RE = /^protection from (.+)$/i;

const resolveKeywordId = (raw: string): KeywordId => {
  // Try direct display name lookup (handles "Flying", "First Strike", "Jump-start", etc.)
  const byDisplay = keywordIdFromDisplayName(raw);
  if (byDisplay !== null) return byDisplay;
  // Try replacing underscores with spaces (for snake_case input)
  const normalizedUnderscore = raw.replace(/_/g, " ");
  const byUnderscoreNorm = keywordIdFromDisplayName(normalizedUnderscore);
  if (byUnderscoreNorm !== null) return byUnderscoreNorm;
  // Try splitting PascalCase / camelCase inputs into space-separated form
  // (e.g. "CumulativeUpkeep" → "Cumulative Upkeep"). Forge's K: prefix uses
  // PascalCase consistently; the keyword-id table uses spaced display names
  // for multi-word keywords. Insert a space before each interior uppercase
  // letter, then lowercase-tail to match the canonical form ("Cumulative
  // upkeep").
  const pascalSplit = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  if (pascalSplit !== raw) {
    const byPascal = keywordIdFromDisplayName(pascalSplit);
    if (byPascal !== null) return byPascal;
    // Try lowercased-tail variant ("Cumulative Upkeep" → "Cumulative upkeep").
    const parts = pascalSplit.split(" ");
    if (parts.length > 1) {
      const head = parts[0] ?? "";
      const tail = parts.slice(1).map((p) => p.toLowerCase());
      const lowerTail = [head, ...tail].join(" ");
      const byLowerTail = keywordIdFromDisplayName(lowerTail);
      if (byLowerTail !== null) return byLowerTail;
    }
  }
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

  // Two-parameter keywords (e.g. K:Suspend:N:cost). Split tail at FIRST inner
  // colon so the trailing portion (which may itself contain spaces /
  // multi-mana segments) is preserved verbatim.
  const twoSlot = TWO_PARAM_KEYWORDS.get(keyword);
  if (twoSlot) {
    const [firstKey, secondKey] = twoSlot;
    const innerColon = tail.indexOf(":");
    if (innerColon >= 0) {
      const firstRaw = tail.slice(0, innerColon).trim();
      const secondRaw = tail.slice(innerColon + 1).trim();
      const firstVal: ParamValue = { kind: "literal", raw: firstRaw };
      const secondVal: ParamValue = { kind: "literal", raw: secondRaw };
      return {
        keyword,
        params: { [firstKey]: firstVal, [secondKey]: secondVal },
      };
    }
    // Single-segment form (e.g. K:Suspend:0) — store as the first slot only.
    return {
      keyword,
      params: { [firstKey]: { kind: "literal", raw: tail } },
    };
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

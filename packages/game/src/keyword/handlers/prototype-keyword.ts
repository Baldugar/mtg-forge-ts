// SPDX-License-Identifier: GPL-3.0-or-later
// PrototypeKeywordHandler — processes K:Prototype:<cost>:<P/T> keyword
// lines (Brothers' War, CR 702.160) and stamps the alternate cost +
// alt-P/T on the source card so the cast pipeline can offer the
// "smaller" version.
//
// CR 702.160a — "Prototype [cost] — [stats]" — "You may cast this spell
// with different mana cost, color, and size. It keeps its abilities and
// types."
//
// MVP scope:
//   1. Adds "prototype" to card.keywords.
//   2. Stamps `card.prototypeCost` and `card.prototypePT` (the raw "P/T"
//      string from the second slot). The cast pipeline offers a
//      confirmAction; on confirm, totalCost.base is replaced with the
//      prototype cost and a Layer 7b override is registered for P/T.
//      Layer 7b registration is documented under TODO(advanced).
//
// DSL form:
//   K:Prototype:2 R:2/3   → cast for {2}{R} as a 2/3
//   K:Prototype:1 U U:2/2 → cast for {1}{U}{U} as a 2/2
//
// Wave 59 — keyword-line parser cleanup moved prototype into
// TWO_PARAM_KEYWORDS (`cost`:`pt`); the canonical AST is now
// `params: { cost: <mana>, pt: <P/T> }`. The legacy single-slot form
// (where the raw text combines "cost P/T" or "cost:P/T") is retained for
// snapshot-restore tolerance.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

const splitCostAndPT = (raw: string): { cost: string; pt: string | null } => {
  // The cost may itself contain spaces ("2 R") so we split on the LAST
  // colon-or-slash boundary that introduces the P/T pair (which is
  // exactly two integers separated by "/"). Find the first occurrence
  // of /\d+\/\d+/ from the right and split there.
  const ptMatch = raw.match(/\s*(\d+\/\d+)\s*$/);
  if (!ptMatch) return { cost: raw.trim(), pt: null };
  const pt = ptMatch[1] ?? null;
  const cost = raw.slice(0, raw.length - (ptMatch[0]?.length ?? 0)).trim();
  // Trim a trailing colon if the parser preserved it.
  const cleanCost = cost.endsWith(":") ? cost.slice(0, -1).trim() : cost;
  return { cost: cleanCost, pt };
};

export class PrototypeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "prototype" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("prototype");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const ptParam = ast.params?.pt as ParamValue | undefined;
    const rawCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "";
    const rawPt = ptParam && ptParam.kind === "literal" ? (ptParam.raw as string) : "";

    if (rawPt.length > 0) {
      // Canonical TWO_PARAM_KEYWORDS form — slots already split.
      card.prototypeCost = rawCost.length > 0 ? rawCost : "0";
      card.prototypePT = rawPt;
      return;
    }

    // Legacy single-slot form ("2 R 2/3" or "2 R:2/3") — split here.
    const { cost, pt } = splitCostAndPT(rawCost);
    card.prototypeCost = cost.length > 0 ? cost : "0";
    if (pt !== null) card.prototypePT = pt;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("prototype");
    card.prototypeCost = undefined;
    card.prototypePT = undefined;
  }
}

keywordHandlerRegistry.register(PrototypeKeywordHandler);

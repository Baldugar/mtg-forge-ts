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
// Parser note: keyword-line lists prototype in COST_KEYWORDS but only
// gives a single slot. The full "cost:P/T" pair requires the parser's
// two-param-keyword path; until that lands the handler tolerates a
// single-slot literal whose raw form contains the colon (we split on
// the first colon at activation time).
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
    const raw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "";
    const { cost, pt } = splitCostAndPT(raw);
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

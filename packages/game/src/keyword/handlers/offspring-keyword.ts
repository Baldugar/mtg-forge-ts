// SPDX-License-Identifier: GPL-3.0-or-later
// OffspringKeywordHandler — processes K:Offspring:<cost> keyword lines
// (Bloomburrow, CR 702.171) and stamps the offspring cost so the cast
// pipeline can offer the optional "create a 1/1 token copy when this
// enters" additional cost.
//
// CR 702.171a — "Offspring [cost]" — "You may pay an additional [cost]
// as you cast this spell. When this creature enters, if the offspring
// cost was paid, create a token that's a copy of it, except it's 1/1."
//
// MVP scope:
//   1. Adds "offspring" to card.keywords.
//   2. Stamps `card.offspringCost`. The cast pipeline's confirmAction
//      gate fires at additional-cost time; on payment `card.offspringPaid
//      = true`. The ETB-token-copy synthesis is documented under
//      TODO(advanced).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class OffspringKeywordHandler extends KeywordHandler {
  static override readonly keyword = "offspring" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("offspring");

    // "offspring" is not in any of the parser's COST/AMOUNT/TYPE sets,
    // so the parser stores the param under "detail" — tolerate either.
    const costParam =
      (ast.params?.cost as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const offspringCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.offspringCost = offspringCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("offspring");
    card.offspringCost = undefined;
    card.offspringPaid = undefined;
  }
}

keywordHandlerRegistry.register(OffspringKeywordHandler);

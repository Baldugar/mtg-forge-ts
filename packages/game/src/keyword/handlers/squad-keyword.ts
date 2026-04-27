// SPDX-License-Identifier: GPL-3.0-or-later
// SquadKeywordHandler — processes K:Squad:<cost> keyword lines (The List
// / Dominaria United, CR 702.157) and stamps the squad cost on the source
// card so the cast pipeline can offer the per-payment-copy additional
// cost.
//
// CR 702.157a — "Squad [cost]" — "As an additional cost to cast this
// spell, you may pay [cost] any number of times. When this creature
// enters, create that many tokens that are copies of it."
//
// MVP scope:
//   1. Adds "squad" to card.keywords.
//   2. Stamps `card.squadCost`. The cast pipeline reads the slot and
//      loops a confirmAction; on each confirm the cost is added and
//      `card.squadCount` increments. The ETB token-copy synthesis is
//      documented under TODO(advanced).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SquadKeywordHandler extends KeywordHandler {
  static override readonly keyword = "squad" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("squad");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const squadCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.squadCost = squadCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("squad");
    card.squadCost = undefined;
  }
}

keywordHandlerRegistry.register(SquadKeywordHandler);

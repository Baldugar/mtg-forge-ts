// SPDX-License-Identifier: GPL-3.0-or-later
// SpliceKeywordHandler — processes K:Splice:Arcane:cost keyword lines
// (Kamigawa, CR 702.46/702.47). Pairs with the SpliceAltCost in
// altcost/splice.ts.
//
// CR 702.46a — "Splice onto Arcane [cost] — As you cast an Arcane spell,
// you may reveal this card from your hand and pay its splice cost. If
// you do, add this card's effects to that spell."
//
// DSL form:
//   K:Splice:Arcane:cost     → splice subtype = Arcane, cost = "cost"
//
// MVP scope:
//   1. Adds "splice" to card.keywords so the AltCost gate's
//      keyword-presence check fires.
//   2. The actual cost grafting lives in altcost/splice.ts.
//
// TODO(advanced) — Full splice graft requires the cast pipeline to
// support add-on spells. The keyword + AltCost are registered so that
// cards parse and don't break casts; the actual "add this card's
// effects to that spell" path is deferred.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SpliceKeywordHandler extends KeywordHandler {
  static override readonly keyword = "splice" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("splice");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("splice");
  }
}

keywordHandlerRegistry.register(SpliceKeywordHandler);

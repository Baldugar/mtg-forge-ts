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
// Wave 69 — the Arcane text-grafting flow lives in CastPipeline's
// `stepChooseSplices`: it detects Arcane spells, scans the caster's
// hand for K:Splice cards, yields per-splicer confirmations, splices
// each accepted splicer's cost into the spell's total cost, emits
// CardsRevealed, and stamps `card.splicedEffects` on the casting card.
// finalizeStackItem wraps the resolver to dispatch each splicer's
// effect after the parent spell's body resolves.
//
// This handler remains as the registration point that:
//   1. Adds "splice" to card.keywords so the cast pipeline's
//      hand-scan gate (keyword-presence check) fires.
//   2. Lets the SpliceAltCost in altcost/splice.ts continue to register
//      the alt-cost id for completeness.
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

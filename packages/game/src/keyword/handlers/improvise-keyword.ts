// SPDX-License-Identifier: GPL-3.0-or-later
// ImproviseKeywordHandler — processes K:Improvise keyword lines.
//
// CR 702.126 — Improvise: "Your artifacts can help cast this spell. Each
// artifact you tap after you're done activating mana abilities pays for {1}."
// Improvise is a SPELL-LEVEL keyword that modifies the cost-payment step of
// the cast pipeline; it has no effect on the battlefield except as surface
// metadata used by the cast pipeline's step 8.5
// (stepChooseConvokeImproviseTap).
//
// Each tapped artifact pays for one generic mana ({1}) — unlike Convoke, no
// colored-pip substitution is available.
//
// This handler simply adds "improvise" to card.keywords so the cast pipeline
// can detect the keyword on cast and yield the chooseConvokeImproviseTap
// decision. All payment-substitute logic lives in cast-pipeline.ts because it
// threads through ctx.totalCost / ctx.paidAlready, not card-local state.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ImproviseKeywordHandler extends KeywordHandler {
  static override readonly keyword = "improvise" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("improvise");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("improvise");
  }
}

keywordHandlerRegistry.register(ImproviseKeywordHandler);

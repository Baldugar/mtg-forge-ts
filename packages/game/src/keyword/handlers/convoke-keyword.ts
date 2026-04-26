// SPDX-License-Identifier: GPL-3.0-or-later
// ConvokeKeywordHandler — processes K:Convoke keyword lines.
//
// CR 702.51 — Convoke: "Your creatures can help cast this spell. Each creature
// you tap while casting this spell pays for {1} or one mana of that creature's
// color." Convoke is a SPELL-LEVEL keyword that modifies the cost-payment
// step of the cast pipeline; it has no effect on the battlefield except as
// surface metadata used by the cast pipeline's step 8.5
// (stepChooseConvokeImproviseTap).
//
// This handler simply adds "convoke" to card.keywords so the cast pipeline can
// detect the keyword on cast and yield the chooseConvokeImproviseTap decision.
// All payment-substitute logic lives in cast-pipeline.ts because it threads
// through ctx.totalCost / ctx.paidAlready, not card-local state.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ConvokeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "convoke" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("convoke");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("convoke");
  }
}

keywordHandlerRegistry.register(ConvokeKeywordHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// ConspireKeywordHandler — processes K:Conspire keyword lines (Shadowmoor,
// CR 702.78). A spell-level keyword: it does not synthesize an activated
// ability or trigger; it ONLY surfaces the keyword flag so the cast pipeline
// can detect it via card.keywords and yield the chooseConspireTap decision.
//
// CR 702.78a — "Conspire is a keyword that represents an additional cost.
// 'Conspire' means 'As an additional cost to cast this spell, you may tap
// two untapped creatures you control that share a color with it.'"
// CR 702.78b — "If conspire's additional cost was paid, when that spell is
// cast, copy it. If the spell has any targets, you may choose new targets
// for the copy."
//
// All copy + tap logic lives in cast-pipeline.ts step
// `stepChooseConspireTapAndCopy` (Wave 26 addition). This handler keeps the
// keyword set up to date.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ConspireKeywordHandler extends KeywordHandler {
  static override readonly keyword = "conspire" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("conspire");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("conspire");
  }
}

keywordHandlerRegistry.register(ConspireKeywordHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// SkulkKeywordHandler — processes K:Skulk keyword lines (Shadows over
// Innistrad, CR 702.118) and stamps the keyword on the card.
//
// CR 702.118a — "Skulk" — "This creature can't be blocked by creatures
// with greater power."
//
// DSL form:
//   K:Skulk     (no parameters)
//
// MVP scope:
//   1. Adds "skulk" to card.keywords.
//
// Wave 79 — Full Skulk integration is now live in
// combat/keywords/block-restrictions.ts (CR 702.118 — attacker.skulk
// rejects blocker when blocker.power > attacker.power). The keyword
// stamp here is the single source of truth that block-restrictions.ts
// reads via hasKeyword.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SkulkKeywordHandler extends KeywordHandler {
  static override readonly keyword = "skulk" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("skulk");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("skulk");
  }
}

keywordHandlerRegistry.register(SkulkKeywordHandler);

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
// TODO(advanced) — Full Skulk integration registers a block-restriction
// in the combat layer that filters blockers by power. The combat
// pipeline already consults `card.keywords` for menace / fear / shadow,
// so the legality check has a stable hook for "if attacker.skulk and
// blocker.power > attacker.power → reject". Wave 39 stamps the flag so
// the corpus parses; the per-blocker filter lands when the combat
// layer's keyword-restriction shelf is widened.
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

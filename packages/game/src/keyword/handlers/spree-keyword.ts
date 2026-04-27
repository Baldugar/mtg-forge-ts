// SPDX-License-Identifier: GPL-3.0-or-later
// SpreeKeywordHandler — processes K:Spree keyword lines (Outlaws of
// Thunder Junction, CR 702.169) and stamps a flag indicating the spell
// is a Spree spell. The actual mode-additional-costs are encoded in the
// spell's modal AbilityAst lines; this handler exists to register the
// keyword for SVar / probe reads.
//
// CR 702.169a — "Spree" — "Choose one or more additional costs."
//
// MVP scope:
//   1. Adds "spree" to card.keywords.
//   2. Stamps `card.isSpree = true` for SVar / cast-pipeline reads. The
//      per-mode-additional-cost wiring is documented under TODO(advanced).
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SpreeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "spree" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("spree");
    card.isSpree = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("spree");
    card.isSpree = undefined;
  }
}

keywordHandlerRegistry.register(SpreeKeywordHandler);

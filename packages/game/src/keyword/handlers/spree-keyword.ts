// SPDX-License-Identifier: GPL-3.0-or-later
// SpreeKeywordHandler — processes K:Spree keyword lines (Outlaws of
// Thunder Junction, CR 702.169) and stamps a flag indicating the spell
// is a Spree spell. The actual mode-additional-costs are encoded in the
// spell's modal AbilityAst lines; this handler exists to register the
// keyword for SVar / probe reads.
//
// CR 702.169a — "Spree" — "Choose one or more additional costs."
//
// Scope:
//   1. Adds "spree" to card.keywords.
//   2. Stamps `card.isSpree = true` for SVar / cast-pipeline reads.
//      Wave 61.C closed the cast-pipeline tail: cast-pipeline.ts now
//      yields a `chooseSpreeModes` decision when `card.isSpree === true`,
//      splices each chosen mode's ModeCost into the base raw cost, and
//      stamps `card.spreeChosenModes` so CharmEffect at resolve time
//      applies exactly the chosen subset. No advanced-tail wiring
//      belongs here.
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

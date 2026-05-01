// SPDX-License-Identifier: GPL-3.0-or-later
// VisitKeywordHandler — processes K:Visit keyword lines (Unfinity)
// and stamps the source so the attractions pipeline can fire its visit-
// triggered abilities when the controller "visits" the attraction (rolls
// a die during their turn matching the attraction's lit numbers).
//
// Scope:
//   1. Adds "visit" to card.keywords.
//   2. Stamps `card.visit = true`. The visit-trigger flow lives in the
//      ability layer: `SP$ VisitAttraction` (visit-attraction.ts) emits
//      the canonical AttractionVisited event, which the Wave-22 visit-
//      attraction trigger handler matches and dispatches via the source
//      card's printed visit-triggered ability. The keyword's contract is
//      the durable `visit` stamp; no advanced-tail wiring belongs here.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class VisitKeywordHandler extends KeywordHandler {
  static override readonly keyword = "visit" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("visit");
    card.visit = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("visit");
    card.visit = undefined;
  }
}

keywordHandlerRegistry.register(VisitKeywordHandler);

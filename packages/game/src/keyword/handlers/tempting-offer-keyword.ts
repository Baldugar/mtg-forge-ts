// SPDX-License-Identifier: GPL-3.0-or-later
// TemptingOfferKeywordHandler — processes K:TemptingOffer keyword lines
// (Commander 2014, the "Offerings" cycle pattern) and stamps the keyword
// on the card.
//
// Tempting Offer is, in Forge data, encoded as a trigger Mode (e.g.
// `Mode$ TemptingOffer` on the trigger line) rather than a K:- line —
// the trigger fires once and yields a per-opponent confirm loop where
// each opponent may copy the resolution. Wave 39's keyword handler
// claims a stable id (`tempting_offer`) so the canonical form has a
// hook even before the trigger Mode lands; in Forge data the K:- form
// is rare but where present it is honoured here.
//
// MVP scope:
//   1. Adds "tempting_offer" to card.keywords.
//
// TODO(advanced) — Full Tempting Offer integration registers a self-
// activating trigger that, on resolution, yields a per-opponent
// confirmAction in turn order ("Will you copy this offering?") and
// re-resolves the parent ability (SVar pointer) for each opponent that
// confirms. The pattern is shared with Tempting Wurm and the C14 cycle.
// Wave 39 stamps the flag so the corpus parses; the per-opponent
// confirm-loop lands when the trigger Mode handler ships.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class TemptingOfferKeywordHandler extends KeywordHandler {
  static override readonly keyword = "tempting_offer" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("tempting_offer");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("tempting_offer");
  }
}

keywordHandlerRegistry.register(TemptingOfferKeywordHandler);

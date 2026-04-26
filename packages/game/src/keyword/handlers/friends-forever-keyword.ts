// SPDX-License-Identifier: GPL-3.0-or-later
// FriendsForeverKeywordHandler — processes K:Friends forever (Commander
// Legends, CR 702.137-style) and stamps the keyword on the card.
//
// Forge data prints this mechanic as `K:Partner:Friends forever` rather
// than as a standalone line; the engine accepts both shapes — when the
// freestanding form is normalised through the keyword-id table the
// canonical id is `friends_forever`. The Partner-with-detail wiring
// (deck-validation + 100-card command zone) lives in the deck builder
// and is outside the runtime's scope.
//
// Effective rules text — "You can have two commanders if both have
// 'Friends forever'." Each card with the keyword can be paired with any
// other Friends-forever commander as a 2-mana-value commander pair.
//
// MVP scope:
//   1. Adds "friends_forever" to card.keywords.
//
// TODO(advanced) — Full Friends Forever integration is a deck-building
// constraint enforced at lobby/deck-validation time. The runtime engine
// only needs the flag for downstream commander-related queries (the UI
// surfaces the pair, the SBA layer treats the second commander as
// commander-typed). Wave 39 stamps the flag so the keyword resolves at
// card-load; the validator wiring lands once the deck-validation layer
// is widened.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class FriendsForeverKeywordHandler extends KeywordHandler {
  static override readonly keyword = "friends_forever" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("friends_forever");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("friends_forever");
  }
}

keywordHandlerRegistry.register(FriendsForeverKeywordHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// MutateKeywordHandler — processes K:Mutate:cost keyword lines.
//
// CR 702.139 — Mutate (Ikoria). "Mutate [cost] — If you cast this spell for
// its mutate cost, put it over or under target non-Human creature you own.
// They become the same object as that creature, with the abilities of all
// cards in the merged stack and the name, types, P/T, and mana cost of the
// top card."
//
// This handler is intentionally light — it only adds the "mutate" KeywordId
// to Card.keywords so combat/SBAs/UI can interrogate `card.keywords?.has("mutate")`.
// The alt-cost machinery (which actually replaces the spell's mana cost and
// drives the merge) lives in `altcost/mutate.ts`; the resolveStackItem
// branch (which performs the merge instead of the normal ETB-as-creature
// flow) lives in `resolve/effect-resolve.ts`.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class MutateKeywordHandler extends KeywordHandler {
  static override readonly keyword = "mutate" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("mutate");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("mutate");
  }
}

keywordHandlerRegistry.register(MutateKeywordHandler);

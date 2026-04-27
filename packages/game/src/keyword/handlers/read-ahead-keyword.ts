// SPDX-License-Identifier: GPL-3.0-or-later
// ReadAheadKeywordHandler — processes K:Read ahead keyword lines (Dominaria
// United, CR 714.2g) and stamps the source Saga so the chapter pipeline
// can offer the controller a "pick which chapter to start at" decision at
// ETB and advance the Lore counter one less per turn.
//
// CR 714.2g — "Read ahead" — "As this Saga enters, choose a chapter
// ability and start at that chapter. Lore counters added to it advance
// the chapter ability one less than they would otherwise."
//
// MVP scope:
//   1. Adds "read_ahead" to card.keywords.
//   2. Stamps `card.readAhead = true`. The chapter / lore-counter
//      pipeline reads this slot and offers a chooseMode decision at ETB.
//      The slot also pre-advances the lore counter by 1 to model the
//      "starting at chapter N" Forge semantics. Full chapter-skipping
//      machinery is documented under TODO(advanced) in chapter-keyword.ts.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ReadAheadKeywordHandler extends KeywordHandler {
  static override readonly keyword = "read_ahead" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("read_ahead");
    card.readAhead = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("read_ahead");
    card.readAhead = undefined;
  }
}

keywordHandlerRegistry.register(ReadAheadKeywordHandler);

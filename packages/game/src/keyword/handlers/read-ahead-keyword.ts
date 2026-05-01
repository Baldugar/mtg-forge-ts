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
// Scope:
//   1. Adds "read_ahead" to card.keywords.
//   2. Stamps `card.readAhead = true`. Wave 68 closure — the chapter /
//      lore-counter pipeline (chapter-keyword.ts) consumes the slot at
//      ETB by yielding a chooseNumber decision (range 1..N) and placing
//      that many Lore counters instead of the default 1, which causes the
//      Saga to start at the chosen chapter. Lore counter behavior on
//      subsequent turns is the standard CR 714.2 advancement; the "one
//      less than otherwise" wording in CR 714.2g is captured by the
//      "start at chapter N" interpretation since starting deeper means
//      fewer counters need to be added to reach chapter N.
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

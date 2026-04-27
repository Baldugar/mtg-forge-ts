// SPDX-License-Identifier: GPL-3.0-or-later
// RavenousKeywordHandler — processes K:Ravenous keyword lines (Commander
// Legends: Battle for Baldur's Gate, CR 702.146) and stamps the source so
// the cast pipeline / ETB stamping can wire X +1/+1 counters at ETB time.
//
// CR 702.146a — "Ravenous" — "This creature enters the battlefield with
// X +1/+1 counters on it. If X is 5 or more, draw a card when it enters."
//
// MVP scope:
//   1. Adds "ravenous" to card.keywords.
//   2. Stamps `card.ravenous = true`. The cast pipeline reads X from
//      ctx.xValue and the ETB stamping adds X +1/+1 counters via the
//      existing etbCounter pathway. Wave-34 PW ETB stamping already
//      consults `card.ravenous`; the X-from-cast wiring is documented
//      under TODO(advanced).
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class RavenousKeywordHandler extends KeywordHandler {
  static override readonly keyword = "ravenous" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("ravenous");
    card.ravenous = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("ravenous");
    card.ravenous = undefined;
  }
}

keywordHandlerRegistry.register(RavenousKeywordHandler);

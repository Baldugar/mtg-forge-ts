// SPDX-License-Identifier: GPL-3.0-or-later
// DecayedKeywordHandler — processes K:Decayed keyword lines (Innistrad:
// Midnight Hunt, CR 702.148) and stamps the source so the combat / SBA
// pipelines model "can't block" + "sacrifice if attacks".
//
// CR 702.148a — "Decayed" — "This creature can't block. When this
// creature attacks, sacrifice it at end of combat."
//
// MVP scope:
//   1. Adds "decayed" to card.keywords.
//   2. Stamps `card.decayed = true`. Combat-handler reads this slot when
//      enumerating legal blockers (a decayed creature is excluded). The
//      "sacrifice at end of combat after attacking" delayed-trigger is
//      documented under TODO(advanced).
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class DecayedKeywordHandler extends KeywordHandler {
  static override readonly keyword = "decayed" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("decayed");
    card.decayed = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("decayed");
    card.decayed = undefined;
  }
}

keywordHandlerRegistry.register(DecayedKeywordHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// DredgeKeywordHandler — processes K:Dredge:N keyword lines (Ravnica;
// CR 702.52). The dredge replacement only ever fires while the card is
// in its owner's graveyard; the runtime expression of dredge lives in
// game-action.drawCards (which checks card.dredgeAmount on each
// per-card draw to offer the dredge alternative).
//
// CR 702.52a — "Dredge N": "If you would draw a card while this card is
// in your graveyard, you may instead put exactly N cards from the top
// of your library into your graveyard and return this card to your hand."
//
// MVP scope:
//   1. Add "dredge" to card.keywords.
//   2. Stamp card.dredgeAmount = N. drawCards reads this slot.
//   3. No trigger / no replacement registration — dredge is consulted
//      at draw time directly (its replacement effect can't be a normal
//      ReplacementAbility because it must yield a player decision; the
//      replacement-handler interface is synchronous).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class DredgeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "dredge" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("dredge");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const nRaw =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 0;
    const safeN = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 0;
    card.dredgeAmount = safeN;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("dredge");
    card.dredgeAmount = undefined;
  }
}

keywordHandlerRegistry.register(DredgeKeywordHandler);

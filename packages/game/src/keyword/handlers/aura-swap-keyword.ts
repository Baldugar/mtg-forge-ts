// SPDX-License-Identifier: GPL-3.0-or-later
// AuraSwapKeywordHandler — processes K:Aura swap:<cost> keyword lines
// (Future Sight, CR 702.65) and stamps the activated swap-cost on the
// source Aura so the activated-ability surface can offer the swap mode.
//
// CR 702.65a — "Aura swap [cost]" — "[cost]: You may exchange this Aura
// with an Aura card in your hand."
//
// MVP scope:
//   1. Adds "aura_swap" to card.keywords.
//   2. Stamps `card.auraSwap` (the raw cost string). The activated ability
//      synthesis is documented under TODO(advanced); the slot is observable
//      for replays / SVar reads.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class AuraSwapKeywordHandler extends KeywordHandler {
  static override readonly keyword = "aura_swap" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("aura_swap");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.auraSwap = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("aura_swap");
    card.auraSwap = undefined;
  }
}

keywordHandlerRegistry.register(AuraSwapKeywordHandler);

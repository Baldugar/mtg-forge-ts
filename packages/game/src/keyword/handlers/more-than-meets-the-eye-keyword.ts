// SPDX-License-Identifier: GPL-3.0-or-later
// MoreThanMeetsTheEyeKeywordHandler — processes K:More Than Meets the Eye:
// <cost> keyword lines (Universes Beyond: Transformers, CR 702.176) and
// stamps the alt-face cast cost on the source card so the cast pipeline
// can offer the alt-cost arm.
//
// CR 702.176a — "More Than Meets the Eye [cost]" — "You may cast this
// card converted [the alt-face P/T/types] for its more-than-meets-the-eye
// cost."
//
// MVP scope:
//   1. Adds "more_than_meets_the_eye" to card.keywords.
//   2. Stamps `card.moreThanMeetsTheEyeCost`. The cast pipeline's alt-cost
//      surface reads the slot; the alt-face conversion (P/T/types swap on
//      resolution) is documented under TODO(advanced) — Wave 55's morph
//      flip-up scaffolding can be reused once the data layer carries the
//      alt-face metadata.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class MoreThanMeetsTheEyeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "more_than_meets_the_eye" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("more_than_meets_the_eye");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.moreThanMeetsTheEyeCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("more_than_meets_the_eye");
    card.moreThanMeetsTheEyeCost = undefined;
  }
}

keywordHandlerRegistry.register(MoreThanMeetsTheEyeKeywordHandler);

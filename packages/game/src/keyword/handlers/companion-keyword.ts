// SPDX-License-Identifier: GPL-3.0-or-later
// CompanionKeywordHandler — processes K:Companion:<condition>:<reminder>
// keyword lines (Ikoria, CR 702.139) and stamps the keyword + condition
// slot on the card.
//
// CR 702.139a — "Companion <restriction> — If your starting deck meets
// the restriction, you may put this card from outside the game into your
// sideboard. After your first turn, pay {3}, then this card goes to your
// hand from outside the game."
//
// DSL form (Forge):
//   K:Companion:Card.cmcM20:Your starting deck contains only cards with
//                            even mana values.
//   K:Companion:Card.YouCtrl+power_eq2 …
//   K:Companion:<condition>:<reminder text>
//
// The first colon-delimited segment after the K:Companion head is the
// condition (a Forge `Valid$` predicate); the trailing segment is the
// reminder text. The parser's COMPANION isn't in TWO_PARAM_KEYWORDS so
// it currently lands as `params.detail = "<condition>:<reminder>"`. We
// pull the condition out of the detail by splitting on the first colon.
//
// MVP scope:
//   1. Adds "companion" to card.keywords.
//   2. Stamps `card.companionCondition = <condition>` so future
//      deck-validation can read it back.
//
// TODO(advanced) — Full Companion integration introduces a sideboard
// slot, an outside-the-game zone, and a 3-mana cost-to-hand activated
// ability that becomes legal "after your first turn". The deck-
// validation portion is a lobby-time concern; the in-game cost-to-hand
// path requires a new zone (companion / sideboard outside-the-game) and
// a sorcery-speed activated SpellAbility activated from that zone.
// Wave 39 stamps the keyword + condition so the corpus parses; the rest
// lands when the deckbuilder + sideboard zones are widened.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class CompanionKeywordHandler extends KeywordHandler {
  static override readonly keyword = "companion" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("companion");

    // K:Companion is parsed as a single-param `detail` keyword (no entry in
    // TWO_PARAM_KEYWORDS), so the raw tail "<condition>:<reminder>" is
    // packed into params.detail. Split on the first colon to recover the
    // condition.
    const detailParam = ast.params?.detail as ParamValue | undefined;
    const detailRaw = detailParam && detailParam.kind === "literal" ? (detailParam.raw as string) : "";
    const colon = detailRaw.indexOf(":");
    const condition = colon >= 0 ? detailRaw.slice(0, colon).trim() : detailRaw.trim();

    (card as unknown as { companionCondition?: string }).companionCondition = condition;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("companion");
    Reflect.deleteProperty(card as object, "companionCondition");
  }
}

keywordHandlerRegistry.register(CompanionKeywordHandler);

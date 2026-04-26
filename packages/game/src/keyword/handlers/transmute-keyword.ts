// SPDX-License-Identifier: GPL-3.0-or-later
// TransmuteKeywordHandler — processes K:Transmute:<cost> keyword lines
// (Dissension, CR 702.49) and synthesizes a sorcery-speed Hand-zone
// activated SpellAbility on the card.
//
// CR 702.49a — "Transmute [cost] — [cost], Discard this card: Search
// your library for a card with the same converted mana cost as this
// card, reveal it, and put it into your hand. Then shuffle. Activate
// only as a sorcery."
//
// DSL form:
//   K:Transmute:1 U U      → cost = "1 U U"
//
// MVP scope:
//   1. Adds "transmute" to card.keywords.
//   2. Synthesizes a Hand-zone activated, sorcery-speed SpellAbility
//      with cost `<cost>, Discard CARDNAME` and handlerKey "Transmute".
//      The TransmuteEffect resolver searches the library for a card
//      with the same printed mana value, moves it to the controller's
//      hand, and shuffles the library.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class TransmuteKeywordHandler extends KeywordHandler {
  static override readonly keyword = "transmute" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("transmute");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const transmuteMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "Transmute", params: {} },
      cost: { raw: `${transmuteMana}, Discard CARDNAME` },
      rulesText: `Transmute ${transmuteMana} — discard this card: Search your library for a card with the same mana value, reveal it, and put it into your hand. Then shuffle. Activate only as a sorcery.`,
    };

    const def = card.paperCard.definition;
    const svars = (def?.svars as ReadonlyMap<string, SVarAst>) ?? new Map<string, SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Hand]),
      new Set(["transmute", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("transmute");
  }
}

keywordHandlerRegistry.register(TransmuteKeywordHandler);

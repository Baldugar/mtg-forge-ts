// SPDX-License-Identifier: GPL-3.0-or-later
// NinjutsuKeywordHandler — processes K:Ninjutsu:<cost> keyword lines
// (Betrayers of Kamigawa, CR 702.49) and synthesizes a Hand-zone
// activated SpellAbility.
//
// CR 702.49a — "Ninjutsu [cost]: {cost}, Return an unblocked attacker
// you control to its owner's hand: Put this card from your hand onto
// the battlefield tapped and attacking."
//
// DSL form:
//   K:Ninjutsu:1 U      → ninjutsu cost {1}{U}
//
// This handler:
//   1. Adds "ninjutsu" to card.keywords.
//   2. Synthesizes an activated SpellAbility, with handlerKey "Ninjutsu",
//      activeInZones = {Hand}, costRaw = the ninjutsu cost. The Ninjutsu
//      effect itself yields a chooseCard decision over unblocked attackers
//      and performs the swap (return attacker to hand, move source to
//      battlefield tapped + attacking).
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class NinjutsuKeywordHandler extends KeywordHandler {
  static override readonly keyword = "ninjutsu" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("ninjutsu");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const costRaw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Ninjutsu",
        params: {},
      },
      cost: { raw: costRaw },
      rulesText: `Ninjutsu ${costRaw} — return an unblocked attacker you control to its owner's hand: Put this card onto the battlefield tapped and attacking.`,
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
      new Set(["ninjutsu"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("ninjutsu");
  }
}

keywordHandlerRegistry.register(NinjutsuKeywordHandler);

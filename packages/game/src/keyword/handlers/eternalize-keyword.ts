// SPDX-License-Identifier: GPL-3.0-or-later
// EternalizeKeywordHandler — processes K:Eternalize:<cost> keyword lines
// (Hour of Devastation, CR 702.139) and synthesizes a Graveyard-zone
// activated SpellAbility on the card.
//
// CR 702.139 — "Eternalize [cost]: [cost], Exile this card from your
// graveyard: Create a token that's a copy of it, except it's a 4/4 black
// Zombie [original types] with no mana cost. Activate only as a sorcery."
//
// DSL form: `K:Eternalize:<costStr>`
//   K:Eternalize:3 W W   → eternalize cost {3}{W}{W}
//
// This handler:
//   1. Adds "eternalize" to card.keywords.
//   2. Synthesizes an activated SpellAbility, with handlerKey "Eternalize",
//      activeInZones = {Graveyard}, costRaw = "<eternalizeMana>,
//      ExileFromGrave<1/CARDNAME>". The Eternalize effect resolves to a
//      token copy with overrides (black, +Zombie, no mana cost, 4/4 P/T).
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class EternalizeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "eternalize" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("eternalize");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const eternalizeMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Eternalize",
        params: {},
      },
      cost: { raw: `${eternalizeMana}, ExileFromGrave<1/CARDNAME>` },
      rulesText: `Eternalize ${eternalizeMana} — exile this card from your graveyard: Create a token copy of it (4/4 black Zombie, no mana cost). Activate only as a sorcery.`,
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
      new Set([ZoneType.Graveyard]),
      new Set(["eternalize", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("eternalize");
  }
}

keywordHandlerRegistry.register(EternalizeKeywordHandler);

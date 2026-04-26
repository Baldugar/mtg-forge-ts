// SPDX-License-Identifier: GPL-3.0-or-later
// EmbalmKeywordHandler — processes K:Embalm:<cost> keyword lines (Amonkhet,
// CR 702.131) and synthesizes a Graveyard-zone activated SpellAbility on
// the card.
//
// CR 702.131 — "Embalm [cost]: [cost], Exile this card from your graveyard:
// Create a token that's a copy of it, except it's a white Zombie
// [original types] with no mana cost. Activate only as a sorcery."
//
// DSL form: `K:Embalm:<costStr>`
//   K:Embalm:3 W      → embalm cost {3}{W}
//
// This handler:
//   1. Adds "embalm" to card.keywords.
//   2. Synthesizes an activated SpellAbility, with handlerKey "Embalm",
//      activeInZones = {Graveyard}, costRaw = "<embalmMana>, ExileFromGrave
//      <1/CARDNAME>". The Embalm effect resolves to a token copy of the
//      source with a tokenOverrides stamp (white, +Zombie, no mana cost).
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class EmbalmKeywordHandler extends KeywordHandler {
  static override readonly keyword = "embalm" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("embalm");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const embalmMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Embalm",
        params: {},
      },
      cost: { raw: `${embalmMana}, ExileFromGrave<1/CARDNAME>` },
      rulesText: `Embalm ${embalmMana} — exile this card from your graveyard: Create a token copy of it (white Zombie, no mana cost). Activate only as a sorcery.`,
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
      new Set(["embalm", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("embalm");
  }
}

keywordHandlerRegistry.register(EmbalmKeywordHandler);

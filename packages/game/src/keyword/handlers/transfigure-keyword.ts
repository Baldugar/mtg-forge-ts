// SPDX-License-Identifier: GPL-3.0-or-later
// TransfigureKeywordHandler — processes K:Transfigure:<cost> keyword
// lines (Future Sight, CR 702.74) and synthesizes a battlefield-zone
// activated SpellAbility that sacrifices self to tutor a creature with
// the same converted mana cost.
//
// CR 702.74a — "Transfigure [cost]" — "[cost], Sacrifice this creature:
// Search your library for a creature card with the same mana value as
// this creature, put it onto the battlefield, then shuffle. Activate
// only as a sorcery."
//
// MVP scope:
//   1. Adds "transfigure" to card.keywords.
//   2. Synthesizes a Battlefield-zone, sorcery-speed SpellAbility with
//      cost `<cost>, Sac<1/CARDNAME>` and handlerKey "Transfigure". The
//      tutor synthesis is documented under TODO(advanced).
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class TransfigureKeywordHandler extends KeywordHandler {
  static override readonly keyword = "transfigure" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("transfigure");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const transfigureCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "Transfigure", params: {} },
      cost: { raw: `${transfigureCost}, Sac<1/CARDNAME>` },
      rulesText: `Transfigure ${transfigureCost} — Sacrifice this and pay ${transfigureCost}: tutor a creature with the same mana value. Sorcery only.`,
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
      new Set([ZoneType.Battlefield]),
      new Set(["transfigure", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("transfigure");
  }
}

keywordHandlerRegistry.register(TransfigureKeywordHandler);

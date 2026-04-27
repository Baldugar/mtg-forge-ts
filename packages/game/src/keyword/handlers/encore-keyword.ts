// SPDX-License-Identifier: GPL-3.0-or-later
// EncoreKeywordHandler — processes K:Encore:<cost> keyword lines
// (Commander Legends, CR 702.142) and synthesizes a graveyard-zone
// activated SpellAbility that exiles self and creates a tapped + attacking
// token copy of self for each opponent.
//
// CR 702.142a — "Encore [cost]" — "[cost], Exile this card from your
// graveyard: For each opponent, create a token that's a copy of this
// card, except it's a Spirit in addition to its other types. Each token
// gains haste and is tapped and attacking that opponent. Sacrifice them
// at the beginning of the next end step. Activate only as a sorcery."
//
// MVP scope:
//   1. Adds "encore" to card.keywords.
//   2. Synthesizes a Graveyard-zone activated, sorcery-speed
//      SpellAbility with cost `<cost>, ExileFromGrave<1/CARDNAME>` and
//      handlerKey "Encore". The Encore resolver synthesis is documented
//      under TODO(advanced); the SA registration captures the durable
//      contract.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class EncoreKeywordHandler extends KeywordHandler {
  static override readonly keyword = "encore" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("encore");

    // Wave 59 — keyword-line parser cleanup moved encore into
    // COST_KEYWORDS, so the canonical slot is `cost`. The legacy `detail`
    // fallback is retained for snapshot-restore tolerance only.
    const costParam =
      (ast.params?.cost as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const encoreCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "Encore", params: {} },
      cost: { raw: `${encoreCost}, ExileFromGrave<1/CARDNAME>` },
      rulesText: `Encore ${encoreCost} — exile this from your graveyard: For each opponent, create a haste-token copy that's a Spirit, tapped and attacking that opponent. Sacrifice them at end step. Sorcery.`,
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
      new Set(["encore", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("encore");
  }
}

keywordHandlerRegistry.register(EncoreKeywordHandler);

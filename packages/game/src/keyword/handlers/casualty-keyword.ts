// SPDX-License-Identifier: GPL-3.0-or-later
// CasualtyKeywordHandler — processes K:Casualty:N keyword lines (Streets
// of New Capenna, CR 702.152) and stamps the casualty cost slot on the
// source card so the cast pipeline can offer the additional sacrifice as
// an optional cost producing a copy of the spell.
//
// CR 702.152a — "Casualty N" — "As you cast this spell, you may
// sacrifice a creature with power N or greater. When you do, copy this
// spell."
//
// MVP scope:
//   1. Adds "casualty" to card.keywords.
//   2. Stamps `card.casualtyAmount = N`. The cast pipeline reads this
//      slot and yields a confirmAction; on confirm the controller
//      chooses a creature to sacrifice and the spell is copied. The
//      copy-on-cast wiring is documented under TODO(advanced).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class CasualtyKeywordHandler extends KeywordHandler {
  static override readonly keyword = "casualty" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("casualty");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.casualtyAmount = n;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("casualty");
    card.casualtyAmount = undefined;
  }
}

keywordHandlerRegistry.register(CasualtyKeywordHandler);

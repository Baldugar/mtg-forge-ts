// SPDX-License-Identifier: GPL-3.0-or-later
// KickerKeywordHandler / MultikickerKeywordHandler — process K:Kicker:<cost>
// and K:Multikicker:<cost> keyword lines (CR 702.32) and stamp slots on the
// source card so the cast pipeline's stepDetermineTotalCost can offer the
// optional additional cost at cast time.
//
// CR 702.32a — "Kicker [cost]" — "You may pay an additional [cost] as you
// cast this spell."
// CR 702.32b — "Multikicker [cost]" — "You may pay an additional [cost] any
// number of times as you cast this spell."
//
// MVP scope:
//   1. Adds "kicker" / "multikicker" to card.keywords.
//   2. Stamps `card.kickerCost = <costStr>` (Kicker) or
//      `card.multikickerCost = <costStr>` (Multikicker). The cast pipeline
//      reads these slots and yields a confirmAction. On confirm, the cost
//      string is appended to ctx.totalCost.base.raw and the source card
//      gets `wasKicked = true` (Kicker) / `kickerCount = N` (Multikicker).
//
// Wave 51 will consume `wasKicked` / `kickerCount` for Count$Kicked SVar
// resolution, branching the spell's printed effect on whether kicker was
// paid.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class KickerKeywordHandler extends KeywordHandler {
  static override readonly keyword = "kicker" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("kicker");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const kickerCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.kickerCost = kickerCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("kicker");
    card.kickerCost = undefined;
  }
}

export class MultikickerKeywordHandler extends KeywordHandler {
  static override readonly keyword = "multikicker" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("multikicker");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const multikickerCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.multikickerCost = multikickerCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("multikicker");
    card.multikickerCost = undefined;
  }
}

keywordHandlerRegistry.register(KickerKeywordHandler);
keywordHandlerRegistry.register(MultikickerKeywordHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// SneakKeywordHandler — processes K:Sneak:<cost> keyword lines
// (placeholder for the various "sneak"-style keywords; CR-anonymous —
// Forge groups several activated/conditional sneak-style keywords under
// this id).
//
// MVP scope:
//   1. Adds "sneak" to card.keywords.
//   2. Stamps `card.sneakCost` for SVar / cast-pipeline reads. The full
//      activated synthesis is documented under TODO(advanced).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SneakKeywordHandler extends KeywordHandler {
  static override readonly keyword = "sneak" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("sneak");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const sneakCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.sneakCost = sneakCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("sneak");
    card.sneakCost = undefined;
  }
}

keywordHandlerRegistry.register(SneakKeywordHandler);

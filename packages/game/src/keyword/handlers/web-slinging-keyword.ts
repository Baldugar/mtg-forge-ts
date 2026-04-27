// SPDX-License-Identifier: GPL-3.0-or-later
// WebSlingingKeywordHandler / FirebendingKeywordHandler — process
// K:Web-slinging:<cost> and K:Firebending:<cost> keyword lines
// (Marvel's Spider-Man / Universes Beyond Avatar) and stamp the bonus-
// card alt-cost on the source. Both share the same shape: an additional
// optional reveal-from-hand cost; the cost-pipeline gate is documented
// under TODO(advanced) for each.
//
// MVP scope:
//   1. Adds the keyword to card.keywords.
//   2. Stamps `card.webSlingingCost` / `card.firebendingCost`.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class WebSlingingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "web_slinging" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("web_slinging");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.webSlingingCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("web_slinging");
    card.webSlingingCost = undefined;
  }
}

export class FirebendingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "firebending" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("firebending");
    // firebending has no specific parser slot today; tolerate either cost
    // or detail.
    const costParam =
      (ast.params?.cost as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.firebendingCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("firebending");
    card.firebendingCost = undefined;
  }
}

keywordHandlerRegistry.register(WebSlingingKeywordHandler);
keywordHandlerRegistry.register(FirebendingKeywordHandler);

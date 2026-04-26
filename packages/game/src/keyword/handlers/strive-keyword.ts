// SPDX-License-Identifier: GPL-3.0-or-later
// StriveKeywordHandler — processes K:Strive:<cost> keyword lines
// (Journey into Nyx, CR 702.106) and stamps the keyword on the card.
//
// CR 702.106a — "Strive — This spell costs [cost] more to cast for each
// target beyond the first."
//
// MVP scope:
//   1. Adds "strive" to card.keywords.
//   2. Stamps `card.striveExtraCost = <costStr>` so the cast pipeline
//      can read it when computing the per-extra-target surcharge.
//
// TODO(advanced) — Full Strive integration registers a per-cast cost
// modification that bumps ctx.totalCost.base by `<cost>` for each
// `(targets.length - 1)` extra target chosen. That is structurally the
// same shape as RaiseCost (Wave 6) but parameterised on the in-flight
// SpellAbility's target count. Wave 38 stamps the keyword + cost slot
// so the cast pipeline can pick it up once the per-cast cost-mod hook
// lands; until then the surcharge is not actually charged.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class StriveKeywordHandler extends KeywordHandler {
  static override readonly keyword = "strive" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("strive");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const striveCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    // Stamp the per-extra-target cost on the card so the future cost-mod
    // wiring can read it back. The slot is a duck-typed string for now.
    (card as unknown as { striveExtraCost?: string }).striveExtraCost = striveCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("strive");
    Reflect.deleteProperty(card as object, "striveExtraCost");
  }
}

keywordHandlerRegistry.register(StriveKeywordHandler);

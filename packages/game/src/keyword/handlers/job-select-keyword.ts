// SPDX-License-Identifier: GPL-3.0-or-later
// JobSelectKeywordHandler — processes K:Job select:<choices> keyword lines
// (Final Fantasy Universes Beyond) and stamps the choice list on the source
// card so the cast pipeline / activated-ability surface can offer the
// mode-select decision.
//
// MVP scope:
//   1. Adds "job_select" to card.keywords.
//   2. Stamps `card.jobSelectChoices` (the raw comma-separated mode list).
//      The activation surface that consumes the slot is documented under
//      TODO(advanced) — Job select decoration is observable for tests.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class JobSelectKeywordHandler extends KeywordHandler {
  static override readonly keyword = "job_select" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("job_select");
    const param =
      (ast.params?.detail as ParamValue | undefined) ??
      (ast.params?.type as ParamValue | undefined) ??
      (ast.params?.cost as ParamValue | undefined);
    const choices = param && param.kind === "literal" ? (param.raw as string) : "";
    card.jobSelectChoices = choices;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("job_select");
    card.jobSelectChoices = undefined;
  }
}

keywordHandlerRegistry.register(JobSelectKeywordHandler);

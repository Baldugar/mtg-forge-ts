// SPDX-License-Identifier: GPL-3.0-or-later
// EscalateKeywordHandler — processes K:Escalate:<cost> keyword lines
// (Eldritch Moon, CR 702.122) and stamps the escalate cost on the source
// card so the cast pipeline can apply the per-extra-mode surcharge on
// modal/charm spells.
//
// CR 702.122a — "Escalate [cost]" — "Pay this cost for each mode chosen
// beyond the first."
//
// MVP scope:
//   1. Adds "escalate" to card.keywords.
//   2. Stamps `card.escalateCost`. The cast pipeline (modal-mode-choice
//      step) reads the slot and adds the cost to totalCost.base for
//      each extra mode beyond the first selected.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class EscalateKeywordHandler extends KeywordHandler {
  static override readonly keyword = "escalate" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("escalate");

    // Wave 59 — keyword-line parser cleanup moved escalate into
    // COST_KEYWORDS, so the canonical slot is `cost`. The legacy `detail`
    // fallback is retained for snapshot-restore tolerance only.
    const costParam =
      (ast.params?.cost as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const escalateCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.escalateCost = escalateCost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("escalate");
    card.escalateCost = undefined;
  }
}

keywordHandlerRegistry.register(EscalateKeywordHandler);

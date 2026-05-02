// SPDX-License-Identifier: GPL-3.0-or-later
// TributeKeywordHandler — processes K:Tribute:N keyword lines (Born of
// the Gods, CR 702.99). M6.26 converts this from a triggered ability to
// a static replacement: it stamps `card.tributeAmount = N` and keyword
// add only. The actual interactive opponent-choice + counter-place runs
// inside `GameAction.applyEtbStamping` → `applyTributeReplacement`,
// which mirrors Forge's CR 614 replacement-effect model. Avoids the
// AbilityActivated/StackItemResolved fan-out the previous trigger shape
// produced.
//
// CR 702.99a — "Tribute N" — "As this creature enters, an opponent of
// your choice may put N +1/+1 counters on it. If they don't, the
// alternate 'if no Tribute was paid' trigger fires."
//
// The alt-trigger ("Tributed") remains card-side as a printed `T:Mode$
// Tributed` line; its standard ChangesZone-style trigger handler reads
// `card.tributePaid === false` to gate dispatch (already implemented in
// the prior wave; unchanged by M6.26).
//
// On AltTribute SVar dispatch — Wave 94's sub-SVar lookup is preserved
// inside `applyTributeReplacement` via the existing `Tributed` trigger
// pathway; this keyword handler no longer carries that resolver.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class TributeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "tribute" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("tribute");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.tributeAmount = n;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("tribute");
    card.tributeAmount = undefined;
    card.tributePaid = undefined;
  }
}

keywordHandlerRegistry.register(TributeKeywordHandler);

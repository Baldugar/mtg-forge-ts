// SPDX-License-Identifier: GPL-3.0-or-later
// CompleatedKeywordHandler — processes K:Compleated keyword lines (Phyrexia:
// All Will Be One, CR 702.150) and stamps the planeswalker so the cast
// pipeline / ETB stamping records when the Phyrexian-mana pip was paid as
// 2 life (planeswalker enters with two fewer loyalty counters).
//
// CR 702.150a — "Compleated" — "If a player paid life for any of [its]
// Phyrexian mana symbols, this planeswalker enters the battlefield with
// that many fewer loyalty counters."
//
// Scope:
//   1. Adds "compleated" to card.keywords.
//   2. Stamps `card.compleated = true`. The cast pipeline's mana payment
//      step stamps `card.compleatedPaidLife = true` when at least one Φ
//      pip was paid as life; the PW ETB-loyalty stamping (Wave 34, refined
//      in Wave 65.B) reads the slot and subtracts 2 loyalty (clamped at 0).
//
// Per-pip count: Today's printed corpus has exactly one Φ pip per
// Compleated planeswalker (Jin-Gitaxias, Tamiyo, Tekuthal, Vraska — all
// {ΦΦ}{X}{X}-style or {Φ}-pip cycles where the keyword fires once). The
// boolean stamp therefore covers every printed card. If a future printing
// adds multi-Φ-pip Compleated planeswalkers, switch
// `Card.compleatedPaidLife` from `boolean | undefined` to a `number` count
// and update the Wave 65.B subtraction to `n * 2`. The MVP boolean form
// is forward-compatible — any future N > 1 case requires a one-line type
// change at the read site.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class CompleatedKeywordHandler extends KeywordHandler {
  static override readonly keyword = "compleated" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("compleated");
    card.compleated = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("compleated");
    card.compleated = undefined;
    card.compleatedPaidLife = undefined;
  }
}

keywordHandlerRegistry.register(CompleatedKeywordHandler);

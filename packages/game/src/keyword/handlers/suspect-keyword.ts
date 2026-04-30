// SPDX-License-Identifier: GPL-3.0-or-later
// SuspectKeywordHandler — processes K:Suspect (CR 701.58, Murders at
// Karlov Manor).
//
// CR 701.58a — "To suspect a creature means to apply the following text
// to it for as long as it remains on the battlefield: 'This creature has
// menace and can't block.' "
//
// In the Forge corpus the canonical surface is an ETB trigger that
// invokes `AB$ AlterAttribute | Attributes$ Suspected | Defined$ Self`,
// which the Wave 21 AlterAttributeEffect (extended in Wave 71) routes
// through the same flag-flip the dedicated `AB$ Suspect` handler uses.
// This keyword handler is a forward-compatibility stamp so any card that
// surfaces as a literal `K:Suspect` (innate suspect) registers the
// keyword set entry and immediately marks the source as suspected.
//
// MVP scope:
//   1. Adds "suspect" to card.keywords so hasKeyword("suspect") works
//      from the registry-driven lookup path.
//   2. Stamps `card.suspected = true` so the combat-handler / hasKeyword
//      menace synthesis / Card.Suspected filter all see the source as
//      suspected without waiting for an ETB trigger to fire.
//   3. Bumps the layer-engine epoch so the menace synthesis is visible
//      on the next computeCharacteristics call.
//
// TODO(advanced): the keyword handler does NOT yet emit a CardSuspected
// event because keyword activation runs eagerly during card construction
// (before the card has resolved its ETB), and emitting an event during
// activate() would order before any ETB triggers. The dedicated
// AB$ Suspect / AlterAttribute path emits the event from the resolver
// where it belongs. If a card surfaces in the corpus that strictly
// requires the event at K:Suspect-application time, route through a
// synthesized ETB trigger here instead.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { canBeSuspected } from "../../statics/wave76-gate-helpers.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class SuspectKeywordHandler extends KeywordHandler {
  static override readonly keyword = "suspect" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("suspect");
    // CR 701.58d — already-suspected guard. Re-activation (e.g. after a
    // copy / clone) is a no-op for the slot but still re-stamps the
    // keyword set entry above.
    if (card.suspected !== true) {
      // Wave 76 — CantBeSuspected static gate; matched cards refuse the
      // suspect transition (silent rejection — keyword set entry still
      // stamped above for textual fidelity, but the suspected flag stays
      // false so Layer 6 menace synthesis doesn't fire).
      if (canBeSuspected(ctx.game, ctx.sourceCardId)) {
        card.suspected = true;
        ctx.game.layerEngine.bumpEpoch("suspect-keyword");
      }
    }
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("suspect");
    // Note: we do NOT clear card.suspected on deactivate. Per CR 701.58a
    // the suspect status persists "for as long as it remains on the
    // battlefield" independently of the K:Suspect keyword line; only an
    // explicit cease-being-suspected effect clears the slot.
  }
}

keywordHandlerRegistry.register(SuspectKeywordHandler);

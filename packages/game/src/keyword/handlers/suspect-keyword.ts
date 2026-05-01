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
// Scope:
//   1. Adds "suspect" to card.keywords so hasKeyword("suspect") works
//      from the registry-driven lookup path.
//   2. Stamps `card.suspected = true` so the combat-handler / hasKeyword
//      menace synthesis / Card.Suspected filter all see the source as
//      suspected without waiting for an ETB trigger to fire.
//   3. Bumps the layer-engine epoch so the menace synthesis is visible
//      on the next computeCharacteristics call.
//   4. Emits a `CardSuspected` event so any registered listener (e.g.
//      "whenever this is suspected" triggers) sees the transition. The
//      event uses `sourceId: null` for the innate K:Suspect path since
//      no spell or ability caused the suspect transition (the keyword
//      itself is the cause). The dedicated AB$ Suspect / AlterAttribute
//      path emits with `sourceId: sa.sourceCardId` from its resolver.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { mkEvent } from "@mtg-forge-ts/core";
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
        // Wave 91 — emit CardSuspected so registered listeners
        // ("whenever this is suspected", Investigation watchers, etc.)
        // see the transition. The activate path is sync; we discard the
        // EngineYield envelope return value (registry routing happens
        // synchronously inside emitEvent and is what we need here).
        ctx.game.emitEvent(
          mkEvent("CardSuspected", ctx.game.turn, ctx.game.phase, {
            cardId: ctx.sourceCardId,
            // Innate K:Suspect — no spell/ability caused the transition.
            sourceId: null,
          }),
        );
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

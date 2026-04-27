// SPDX-License-Identifier: GPL-3.0-or-later
// LivingMetalKeywordHandler — processes K:Living metal keyword lines
// (Transformers / The Brothers' War commander, CR-anonymous) and stamps
// a flag indicating the Vehicle becomes a creature on its controller's
// turn without needing to be crewed.
//
// MVP scope:
//   1. Adds "living_metal" to card.keywords.
//   2. Stamps `card.livingMetal = true` for SVar / combat-handler reads.
//      The Layer 4 type-addition gated on `game.activePlayer ===
//      controllerSeat` is documented under TODO(advanced); the existing
//      crew flow + this flag give the combat layer the durable contract.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class LivingMetalKeywordHandler extends KeywordHandler {
  static override readonly keyword = "living_metal" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("living_metal");
    card.livingMetal = true;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("living_metal");
    card.livingMetal = undefined;
  }
}

keywordHandlerRegistry.register(LivingMetalKeywordHandler);

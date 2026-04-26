// SPDX-License-Identifier: GPL-3.0-or-later
// CostUntap — payment of the untap symbol {Q}. The source card must be
// tapped; pay calls game.action.untap(sourceCardId). Mirror of CostTap with
// the sense inverted. Used by Pemmin's Aura ("{1}: Untap CARDNAME"), Sword
// of the Paruns, and any "Q" cost-segment activated ability.
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

export const CostUntap: CostPart = {
  handlerKey: "Untap",

  canPay(ctx: CostPaymentContext): boolean {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    return !!card && card.tapped;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) {
      throw new Error(`CostUntap.pay: no card with id ${ctx.sourceCardId}`);
    }
    if (!card.tapped) {
      throw new Error(`CostUntap.pay: card ${ctx.sourceCardId} is already untapped`);
    }
    yield* ctx.game.action.untap(ctx.sourceCardId);
    return {
      handlerKey: "Untap",
      raw: ctx.raw,
      payload: { cardId: ctx.sourceCardId },
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { cardId } = receipt.payload as { cardId: EntityId };
    // Direct tap bypasses action layer so rollback generates no events.
    const card = ctx.game.cards.get(cardId);
    if (card) card.tapped = true;
  },
};

costPartRegistry.register(CostUntap);

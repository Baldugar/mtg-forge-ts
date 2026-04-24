// SPDX-License-Identifier: GPL-3.0-or-later
// CostTap — payment of the tap symbol {T}. The source card must be untapped;
// pay calls game.action.tap(sourceCardId). Undo sets card.tapped = false
// directly (rollback must not generate tap events).
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

export const CostTap: CostPart = {
  handlerKey: "Tap",

  canPay(ctx: CostPaymentContext): boolean {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    return !!card && !card.tapped;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) {
      throw new Error(`CostTap.pay: no card with id ${ctx.sourceCardId}`);
    }
    if (card.tapped) {
      throw new Error(`CostTap.pay: card ${ctx.sourceCardId} is already tapped`);
    }
    yield* ctx.game.action.tap(ctx.sourceCardId);
    return {
      handlerKey: "Tap",
      raw: ctx.raw,
      payload: { cardId: ctx.sourceCardId },
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { cardId } = receipt.payload as { cardId: EntityId };
    // Direct untap bypasses action layer so rollback generates no events.
    const card = ctx.game.cards.get(cardId);
    if (card) card.tapped = false;
  },
};

costPartRegistry.register(CostTap);

// SPDX-License-Identifier: GPL-3.0-or-later
// CostDiscard — payment of a "discard source card" cost.
// For cycling, the cost is "Discard CARDNAME" — discard the source card itself
// from hand to graveyard. MVP scope: self-discard only.
//
// Supported segment patterns (matched by parseCostString):
//   "Discard"            — bare, means discard source
//   "Discard CARDNAME"   — Forge convention for "discard this card"
//
// pay: moves the source card from Hand to Graveyard via game.action.moveTo,
//   which emits CardChangedZone. A CardDiscarded event is NOT separately
//   emitted here (would require knowing the seat inside moveTo opts); the
//   CardChangedZone is sufficient for trigger watchers in cycling's MVP scope.
// undo: moves the card back to Hand directly. This is best-effort because
//   the CardChangedZone event was already emitted; cycling costs rarely need
//   rollback in practice (the cost succeeds or the ability doesn't activate).
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

export const CostDiscard: CostPart = {
  handlerKey: "Discard",

  canPay(ctx: CostPaymentContext): boolean {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    return !!card && card.zone === ZoneType.Hand;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) {
      throw new Error(`CostDiscard.pay: no card with id ${ctx.sourceCardId}`);
    }
    if (card.zone !== ZoneType.Hand) {
      throw new Error(`CostDiscard.pay: card ${ctx.sourceCardId} is in zone ${card.zone}, not Hand`);
    }
    // Move from Hand to owner's Graveyard. moveTo infers the destination seat
    // via defaultDestinationSeat (owner for Graveyard).
    yield* ctx.game.action.moveTo(ctx.sourceCardId, ZoneType.Graveyard, {
      cause: "discard",
    });
    return {
      handlerKey: "Discard",
      raw: ctx.raw,
      payload: { cardId: ctx.sourceCardId, ownerSeat: card.ownerSeat },
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    // Best-effort rollback: move the card back to hand directly.
    // CardChangedZone event was already emitted so this is imperfect, but
    // cycling costs effectively never abort after CostDiscard succeeds.
    const { cardId } = receipt.payload as { cardId: number; ownerSeat: number };
    const card = ctx.game.cards.get(cardId as import("@mtg-forge-ts/core").EntityId);
    if (!card) return;
    const player = ctx.game.getPlayer(card.ownerSeat);
    const graveyard = player.zones.get(ZoneType.Graveyard);
    const hand = player.zones.get(ZoneType.Hand);
    if (graveyard && hand) {
      graveyard.remove(card.id);
      hand.add(card.id);
      card.zone = ZoneType.Hand;
    }
  },
};

costPartRegistry.register(CostDiscard);

// SPDX-License-Identifier: GPL-3.0-or-later
// CostExileSelfFromGrave — payment of an "exile self from graveyard" cost.
//
// Forge DSL form: `ExileFromGrave<1/CARDNAME>` — used by Embalm and
// Eternalize (Amonkhet / Hour of Devastation, CR 702.131 / 702.139). The
// cost segment names the source card itself; the segment has no target
// grammar. canPay requires the source to be in the graveyard; pay moves
// the card from Graveyard to Exile.
//
// Supported segment patterns (matched by parseCostString):
//   "ExileFromGrave<1/CARDNAME>" — Forge canonical form for Embalm/Eternalize
//   "ExileFromGrave"             — bare form, treated identically (self)
//
// pay: moves the source from Graveyard to Exile via game.action.moveTo.
// undo: best-effort — moves the card back to Graveyard. The CardChangedZone
//   event fired by pay() is irreversible; in practice the cost succeeds or
//   the activated ability doesn't go on the stack, so rollback is rare.
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

export const CostExileSelfFromGrave: CostPart = {
  handlerKey: "ExileFromGrave",

  canPay(ctx: CostPaymentContext): boolean {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    return !!card && card.zone === ZoneType.Graveyard;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) {
      throw new Error(`CostExileSelfFromGrave.pay: no card with id ${ctx.sourceCardId}`);
    }
    if (card.zone !== ZoneType.Graveyard) {
      throw new Error(
        `CostExileSelfFromGrave.pay: card ${ctx.sourceCardId} is in zone ${card.zone}, not Graveyard`,
      );
    }
    yield* ctx.game.action.moveTo(ctx.sourceCardId, ZoneType.Exile, {
      cause: "exile-from-grave",
    });
    return {
      handlerKey: "ExileFromGrave",
      raw: ctx.raw,
      payload: { cardId: ctx.sourceCardId, ownerSeat: card.ownerSeat },
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { cardId } = receipt.payload as {
      cardId: import("@mtg-forge-ts/core").EntityId;
      ownerSeat: import("@mtg-forge-ts/core").PlayerSeat;
    };
    const card = ctx.game.cards.get(cardId);
    if (!card) return;
    const player = ctx.game.getPlayer(card.ownerSeat);
    const exile = player.zones.get(ZoneType.Exile);
    const graveyard = player.zones.get(ZoneType.Graveyard);
    if (exile && graveyard) {
      exile.remove(card.id);
      graveyard.add(card.id);
      card.zone = ZoneType.Graveyard;
    }
  },
};

costPartRegistry.register(CostExileSelfFromGrave);

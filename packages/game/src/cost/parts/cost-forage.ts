// SPDX-License-Identifier: GPL-3.0-or-later
// CostForage — additional cost-part for Bloomburrow Forage (CR 702.171).
//
// "Forage" is paid by EITHER:
//   - exiling exactly 3 cards from your graveyard, OR
//   - sacrificing a Food token you control.
//
// canPay: returns true iff the payer has ≥3 cards in graveyard OR controls
// at least one Food token (creature/artifact subtype "Food").
//
// pay: yields a `chooseForageMode` decision; depending on the responder's
// answer:
//   - mode "exileGy" with 3 ids from graveyard → exile each.
//   - mode "sacFood" with one Food id → sacrifice it.
// Empty / invalid responses leave the cost unpaid (caller treats as failure).
//
// Emits: CardForage event after the cost is paid (so Forage triggers fire
// without requiring a separate effect-side emit). The emit happens INSIDE
// the cost-pay generator at success time.
//
// undo: best-effort no-op — graveyard exiles and Food sacrifices are
// effectively irreversible (the engine has no resurrect-from-exile path).
// Forage costs are paid LAST in the cost plan (mirror of Sacrifice's
// ordering convention) so undo is reachable only on payment-failure of a
// later step, which the orchestration prevents.
import type { DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const REQUIRED_GY_COUNT = 3;
const FOOD_SUBTYPE = "Food";

const enumerateGraveyard = (ctx: CostPaymentContext): EntityId[] => {
  const player = ctx.game.getPlayer(ctx.payerSeat);
  const gy = player.zones.get(ZoneType.Graveyard);
  if (!gy) return [];
  return gy.toArray();
};

const enumerateFood = (ctx: CostPaymentContext): EntityId[] => {
  const ids: EntityId[] = [];
  for (const [id, c] of ctx.game.cards) {
    if (c.controllerSeat !== ctx.payerSeat) continue;
    if (c.zone !== ZoneType.Battlefield) continue;
    const chars = ctx.game.layerEngine.computeCharacteristics(id);
    let hasFood = false;
    for (const sub of chars.subtypes) {
      if (sub === FOOD_SUBTYPE || sub.toLowerCase() === FOOD_SUBTYPE.toLowerCase()) {
        hasFood = true;
        break;
      }
    }
    if (hasFood) ids.push(id);
  }
  return ids;
};

interface ForageReceipt {
  readonly mode: "exileGy" | "sacFood";
  readonly ids: readonly EntityId[];
}

export const CostForage: CostPart = {
  handlerKey: "Forage",

  canPay(ctx: CostPaymentContext): boolean {
    const gy = enumerateGraveyard(ctx);
    if (gy.length >= REQUIRED_GY_COUNT) return true;
    const food = enumerateFood(ctx);
    return food.length >= 1;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const eligibleGyIds = enumerateGraveyard(ctx);
    const eligibleFoodIds = enumerateFood(ctx);
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseForageMode",
        playerSeat: ctx.payerSeat,
        sourceCardId: ctx.sourceCardId,
        eligibleGyIds,
        eligibleFoodIds,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    if (!response || response.kind !== "chooseForageMode") {
      throw new Error("CostForage.pay: invalid or missing chooseForageMode response");
    }

    if (response.mode === "exileGy") {
      const ids = response.cardIds;
      if (ids.length !== REQUIRED_GY_COUNT) {
        throw new Error(`CostForage.pay: exileGy requires exactly ${REQUIRED_GY_COUNT} ids`);
      }
      const allowed = new Set(eligibleGyIds);
      const seen = new Set<EntityId>();
      for (const id of ids) {
        if (!allowed.has(id) || seen.has(id)) {
          throw new Error("CostForage.pay: chosen graveyard id not eligible or duplicate");
        }
        seen.add(id);
      }
      for (const id of ids) {
        yield* ctx.game.action.exile(id, { sourceId: ctx.sourceCardId });
      }
      const receipt: ForageReceipt = { mode: "exileGy", ids: [...ids] };
      yield ctx.game.emitEvent(
        mkEvent("CardForage", ctx.game.turn, ctx.game.phase, { playerSeat: ctx.payerSeat }),
      );
      return { handlerKey: "Forage", raw: ctx.raw, payload: receipt };
    }

    // mode === "sacFood"
    const foodId = response.foodId;
    if (!eligibleFoodIds.includes(foodId)) {
      throw new Error("CostForage.pay: chosen Food id not eligible");
    }
    yield* ctx.game.action.sacrifice(foodId, { sourceId: ctx.sourceCardId });
    const receipt: ForageReceipt = { mode: "sacFood", ids: [foodId] };
    yield ctx.game.emitEvent(
      mkEvent("CardForage", ctx.game.turn, ctx.game.phase, { playerSeat: ctx.payerSeat }),
    );
    return { handlerKey: "Forage", raw: ctx.raw, payload: receipt };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // Exile / sacrifice are irreversible at the engine level. CostForage
    // must be ordered last in the plan so undo is unreachable in practice.
    throw new Error(
      "CostForage.undo: forage payment is non-reversible; callers must order Forage last in the cost plan",
    );
  },
};

costPartRegistry.register(CostForage);

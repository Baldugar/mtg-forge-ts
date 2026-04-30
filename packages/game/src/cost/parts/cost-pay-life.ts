// SPDX-License-Identifier: GPL-3.0-or-later
// CostPayLife — payment of life as an additional cost ("N life" syntax).
// pay: deducts N life via game.action.changeLife. undo: refunds N life
// directly (player.life += N) so rollback doesn't generate extra events.
//
// Wave 70.L — CantPayLife static gate. Before the life-payment, consult
// the registry-walk helper `cantPayLife(game, payerSeat, cause)`: if
// any active CantPayLife gate matches (Angel of Jubilation / Karn's
// Sylex / Yasharn), the cost is unpayable. canPay returns false; pay
// throws.
import type { EngineYield } from "../../action/engine-yield.js";
import { cantPayLife } from "../../statics/wave70l-gate-helpers.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

// Matches "N life" e.g. "2 life", "5 life" (case-insensitive)
const LIFE_RE = /^(\d+)\s+life$/i;

function parseLifeAmount(raw: string): number {
  const m = LIFE_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostPayLife: cannot parse life amount from "${raw}"`);
  return Number.parseInt(m[1], 10);
}

const causeFromCtx = (ctx: CostPaymentContext): { kind: "spell" | "ability" } => ({
  // ctx.kind defaults to "spell" when omitted — preserves the cast-pipeline
  // baseline (mirrors the Wave 11 default in cost-payment.ts).
  kind: ctx.kind === "ability" ? "ability" : "spell",
});

export const CostPayLife: CostPart = {
  handlerKey: "PayLife",

  canPay(ctx: CostPaymentContext): boolean {
    if (cantPayLife(ctx.game, ctx.payerSeat, causeFromCtx(ctx))) return false;
    const n = parseLifeAmount(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    return player.life >= n;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    if (cantPayLife(ctx.game, ctx.payerSeat, causeFromCtx(ctx))) {
      throw new Error(
        `CostPayLife.pay: blocked by active CantPayLife static (Angel of Jubilation / Karn's Sylex / Yasharn) for cost "${ctx.raw}"`,
      );
    }
    const n = parseLifeAmount(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    if (player.life < n) {
      throw new Error(
        `CostPayLife.pay: insufficient life (need ${n}, have ${player.life}) for cost "${ctx.raw}"`,
      );
    }
    yield* ctx.game.action.changeLife(ctx.payerSeat, -n, { cause: "cost" });
    return {
      handlerKey: "PayLife",
      raw: ctx.raw,
      payload: { lifePaid: n },
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { lifePaid } = receipt.payload as { lifePaid: number };
    // Direct mutation for rollback — no events, no replacement pipeline.
    const player = ctx.game.getPlayer(ctx.payerSeat);
    player.life += lifePaid;
  },
};

costPartRegistry.register(CostPayLife);

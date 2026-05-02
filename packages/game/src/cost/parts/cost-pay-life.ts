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
// M6.18 — `PayLife<N>` bracket form used in synthetic Vampiric Tutor /
// Imperial Seal scenarios (Forge-canonical Cost.java accepts this form
// alongside the standard "N life" notation).
// M6.19 — `PayLife<X>` / `PayLife<Y>` for X-cost spells (Toxic Deluge).
// X resolves at pay-time via card.xValueAtCast.
const PAY_LIFE_BRACKET_DIGIT_RE = /^PayLife<(\d+)>$/i;
const PAY_LIFE_BRACKET_VAR_RE = /^PayLife<([A-Z][\w]*)>$/i;

function parseLifeAmount(raw: string, ctx: CostPaymentContext): number {
  const m1 = LIFE_RE.exec(raw);
  if (m1?.[1]) return Number.parseInt(m1[1], 10);
  const m2 = PAY_LIFE_BRACKET_DIGIT_RE.exec(raw);
  if (m2?.[1]) return Number.parseInt(m2[1], 10);
  const m3 = PAY_LIFE_BRACKET_VAR_RE.exec(raw);
  if (m3?.[1]) {
    // M6.19 — `X` / `Y` SVar identifier amounts. Forge resolves these
    // via the X-spell xPaid mechanism — same path mana cost X uses. The
    // cost-payment pipeline stamps `card.xValueAtCast` on the source
    // card during the X-cost mana payment step. For PayLife<X>, mirror
    // that by reading the stamped value here.
    const card = ctx.game.cards.get(ctx.sourceCardId);
    const xValue = (card as unknown as { xValueAtCast?: number } | undefined)?.xValueAtCast ?? 0;
    if (Number.isFinite(xValue) && xValue >= 0) return xValue;
    return 0;
  }
  throw new Error(`CostPayLife: cannot parse life amount from "${raw}"`);
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
    const n = parseLifeAmount(ctx.raw, ctx);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    return player.life >= n;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    if (cantPayLife(ctx.game, ctx.payerSeat, causeFromCtx(ctx))) {
      throw new Error(
        `CostPayLife.pay: blocked by active CantPayLife static (Angel of Jubilation / Karn's Sylex / Yasharn) for cost "${ctx.raw}"`,
      );
    }
    const n = parseLifeAmount(ctx.raw, ctx);
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

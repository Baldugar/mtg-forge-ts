// SPDX-License-Identifier: GPL-3.0-or-later
// CostDamage — payment of "DamageYou<n>". The source deals N damage to the
// activating player as a cost (e.g. self-pingers, "as an additional cost,
// CARDNAME deals X damage to you" mechanics).
//
// pay routes through game.action.damage with sourceId = ctx.sourceCardId,
// targetKind = "player", isCombat = false. The damage replacement chain
// fires normally (so prevention shields work). undo is a no-op — once the
// DamageDealt event has been emitted, restoring life would skip the
// replacement-pipeline'd life change that pay's damage call performed.
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const DAMAGE_RE = /^DamageYou<(\d+)>$/;

const parseAmount = (raw: string): number => {
  const m = DAMAGE_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostDamage: cannot parse "${raw}"`);
  return Number.parseInt(m[1], 10);
};

interface DamageReceipt {
  readonly seat: PlayerSeat;
  readonly amount: number;
}

export const CostDamage: CostPart = {
  handlerKey: "DamageYou",

  canPay(ctx: CostPaymentContext): boolean {
    parseAmount(ctx.raw); // validates parsing
    return ctx.game.cards.get(ctx.sourceCardId) !== undefined;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const n = parseAmount(ctx.raw);
    yield* ctx.game.action.damage(ctx.sourceCardId, "player", ctx.payerSeat, n, false);
    const receipt: DamageReceipt = { seat: ctx.payerSeat, amount: n };
    return {
      handlerKey: "DamageYou",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // DamageDealt + downstream LifeChange events are non-reversible here.
  },
};

costPartRegistry.register(CostDamage);

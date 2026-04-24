// SPDX-License-Identifier: GPL-3.0-or-later
// CostMana — payment of a mana cost (e.g. "R", "2 G", "X"). M5 replaces the
// M4 total-shard-count stub with the real color-aware solver from
// packages/game/src/mana/solver/.
//
// canPay: delegates to solveManaPayment — returns true iff a plan exists.
// pay:    solves, applies the plan (pool mutation + life payment), returns a
//         receipt carrying the pre-payment pool snapshot for undo.
// undo:   restores the pool snapshot + refunds life (via changeLife).
import { ManaCost } from "@mtg-forge-ts/core";
import type { ManaProduced } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import { applyPaymentPlan } from "../../mana/solver/apply-plan.js";
import { solveManaPayment } from "../../mana/solver/solver.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

function getPool(ctx: CostPaymentContext): ManaPool {
  const player = ctx.game.getPlayer(ctx.payerSeat);
  // Player.manaPool is typed `unknown` in SP1 for forward compat; SP3
  // starts populating it with real ManaPool instances. Cast here is safe
  // for tests that seed the pool before calling CostMana.
  return player.manaPool as ManaPool;
}

interface ManaCostReceipt {
  /** Pre-payment pool snapshot (for undo). */
  prePaymentSnapshot: ManaProduced[];
  /** Life paid via phyrexian pips (for undo refund). */
  lifePaid: number;
  /** Bound X value if the cost had X pips. */
  xValue: number;
}

export const CostMana: CostPart = {
  handlerKey: "Mana",

  canPay(ctx: CostPaymentContext): boolean {
    const cost = ManaCost.parse(ctx.raw);
    const pool = getPool(ctx);
    return solveManaPayment(cost, pool) !== null;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const cost = ManaCost.parse(ctx.raw);
    const pool = getPool(ctx);

    // Capture snapshot BEFORE solving so undo can restore the exact pre-pay state.
    const prePaymentSnapshot: ManaProduced[] = pool.snapshot();

    const plan = solveManaPayment(cost, pool);
    if (plan === null) {
      throw new Error(`CostMana.pay: insufficient mana — cannot pay "${ctx.raw}" from current pool`);
    }

    // Apply the plan: drain pool entries and pay life for phyrexian pips.
    yield* applyPaymentPlan(plan, pool, ctx.game, ctx.payerSeat);

    const receipt: ManaCostReceipt = {
      prePaymentSnapshot,
      lifePaid: plan.lifePaid,
      xValue: plan.xValue ?? 0,
    };

    return {
      handlerKey: "Mana",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { prePaymentSnapshot, lifePaid } = receipt.payload as ManaCostReceipt;
    const pool = getPool(ctx);
    pool.restore(prePaymentSnapshot);

    // Refund life paid for phyrexian pips by running changeLife synchronously
    // (drive the generator to completion — changeLife yields events but has
    // no decision points that require external input).
    if (lifePaid > 0) {
      const gen = ctx.game.action.changeLife(ctx.payerSeat, lifePaid, { cause: "phyrexianRefund" });
      let step = gen.next();
      while (!step.done) {
        step = gen.next();
      }
    }
  },
};

costPartRegistry.register(CostMana);

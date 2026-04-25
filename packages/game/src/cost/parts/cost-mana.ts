// SPDX-License-Identifier: GPL-3.0-or-later
// CostMana — payment of a mana cost (e.g. "R", "2 G", "X"). M5 implements
// the real color-aware solver. If the cost has variable (X) pips, the payer
// is prompted with a "chooseX" decision before payment proceeds.
//
// canPay: delegates to solveManaPayment with xValue=0 (conservative check —
//         X costs can always be paid for X=0).
// pay:    if cost has X pips, yields chooseX decision to get the bound value;
//         then solves and applies the plan.
// undo:   restores pool snapshot + refunds phyrexian life.
import { ManaCost } from "@mtg-forge-ts/core";
import type { ManaProduced } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import { applyCostMods } from "../../mana/solver/apply-cost-mods.js";
import { applyPaymentPlan } from "../../mana/solver/apply-plan.js";
import { chooseX, computeMaxX } from "../../mana/solver/choose-x.js";
import { solveManaPayment } from "../../mana/solver/solver.js";
import { gatherCostModsFor } from "../../statics/cost-mod-contributor.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

function getPool(ctx: CostPaymentContext): ManaPool {
  const player = ctx.game.getPlayer(ctx.payerSeat);
  // Player.manaPool is typed `unknown` in SP1 for forward compat; SP3
  // starts populating it with real ManaPool instances. Cast here is safe
  // for tests that seed the pool before calling CostMana.
  return player.manaPool as ManaPool;
}

// Wave 6 — fold cost-modification statics (Jet Medallion, Sphere of
// Resistance, etc.) into the raw mana cost before solving. The "item" we
// hand the filter is the cost-determination context: source card +
// controller + a "spell" kind tag (CostMana sits in the cast pipeline; if
// we ever invoke it from activation paths we'll either flip the tag or
// expose it via CostPaymentContext).
const adjustedCost = (
  rawCost: import("@mtg-forge-ts/core").ManaCost,
  ctx: CostPaymentContext,
): import("@mtg-forge-ts/core").ManaCost => {
  const card = ctx.game.cards.get(ctx.sourceCardId);
  const item = {
    sourceCardId: ctx.sourceCardId,
    controllerSeat: ctx.payerSeat,
    card,
    kind: "spell" as const,
  };
  const mods = gatherCostModsFor(ctx.game, item);
  return applyCostMods(rawCost, mods);
};

interface ManaCostReceipt {
  /** Pre-payment pool snapshot (for undo). */
  prePaymentSnapshot: ManaProduced[];
  /** Life paid via phyrexian pips (for undo refund). */
  lifePaid: number;
  /** Bound X value (0 if cost had no X pips). */
  xValue: number;
}

export const CostMana: CostPart = {
  handlerKey: "Mana",

  canPay(ctx: CostPaymentContext): boolean {
    const cost = adjustedCost(ManaCost.parse(ctx.raw), ctx);
    const pool = getPool(ctx);
    // Conservative check: X=0 means we only verify non-X pips are payable.
    // A player can always choose X=0, so if non-X pips are satisfiable the
    // cost can be paid (even if X=0 is a degenerate choice for some cards).
    return solveManaPayment(cost, pool, { xValue: 0 }) !== null;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const cost = adjustedCost(ManaCost.parse(ctx.raw), ctx);
    const pool = getPool(ctx);

    // --- X binding ---------------------------------------------------
    let xValue = 0;
    if (cost.countX() > 0) {
      const maxBound = computeMaxX(cost, pool);
      xValue = yield* chooseX(ctx.sourceCardId, maxBound);
    }

    // Capture snapshot BEFORE applying so undo can restore the exact pre-pay state.
    const prePaymentSnapshot: ManaProduced[] = pool.snapshot();

    const plan = solveManaPayment(cost, pool, { xValue });
    if (plan === null) {
      throw new Error(
        `CostMana.pay: insufficient mana — cannot pay "${ctx.raw}" (xValue=${xValue}) from current pool`,
      );
    }

    // Apply the plan: drain pool entries and pay life for phyrexian pips.
    yield* applyPaymentPlan(plan, pool, ctx.game, ctx.payerSeat);

    const receipt: ManaCostReceipt = {
      prePaymentSnapshot,
      lifePaid: plan.lifePaid,
      xValue: plan.xValue ?? xValue,
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

    // Refund life paid for phyrexian pips by driving changeLife synchronously.
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

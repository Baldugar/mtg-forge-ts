// SPDX-License-Identifier: GPL-3.0-or-later
// applyPaymentPlan — applies a ManaPaymentPlan to the game state.
//
// For each consumed pool entry: removes it from the pool by rebuilding the
// pool via snapshot/restore (ManaPool has no removeAt, so we snapshot, filter
// by the consumed indices, and restore). If the plan includes life payment
// (phyrexian), delegates to ctx.game.action.changeLife.

import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { ManaPool } from "../mana-pool.js";
import type { ManaPaymentPlan } from "./solver.js";

/**
 * Apply a resolved ManaPaymentPlan to the game state:
 * 1. Remove consumed pool entries by index.
 * 2. If plan.lifePaid > 0, yield changeLife events for the paying player.
 *
 * Context is provided as discrete parameters (pool, game, payerSeat) to
 * keep this function usable from both CostMana and any future payment path
 * that has a pool reference but not a full CostPaymentContext.
 */
export function* applyPaymentPlan(
  plan: ManaPaymentPlan,
  pool: ManaPool,
  game: Game,
  payerSeat: PlayerSeat,
): Generator<EngineYield, void, unknown> {
  // Build the set of indices to remove.
  const indicesToRemove = new Set(plan.consumed.map((c) => c.poolIndex));

  // Rebuild pool: take snapshot, keep only entries NOT in the consumed set.
  const snap = pool.snapshot();
  const remaining = snap.filter((_, i) => !indicesToRemove.has(i));
  pool.restore(remaining);

  // Apply life payment for phyrexian pips.
  if (plan.lifePaid > 0) {
    yield* game.action.changeLife(payerSeat, -plan.lifePaid, { cause: "phyrexian" });
  }
}

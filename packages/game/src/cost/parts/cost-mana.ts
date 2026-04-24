// SPDX-License-Identifier: GPL-3.0-or-later
// CostMana — payment of a mana cost (e.g. "R", "2 G", "X"). M4 stub uses
// total-shard-count vs CMC for canPay and drains CMC shards in LIFO order
// (any color). M5 replaces this with the real color-aware solver.
//
// ManaPool API (SP1 shipped): add / empty / snapshot / restore / size /
// toArray / toJSON. No drain/totalAmount/refund — M4 simulates drain via
// snapshot+restore with a sliced tail.
import { ManaCost } from "@mtg-forge-ts/core";
import type { ManaProduced } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

function getPool(ctx: CostPaymentContext): ManaPool {
  const player = ctx.game.getPlayer(ctx.payerSeat);
  // Player.manaPool is typed `unknown` in SP1 for forward compat; SP3
  // starts populating it with real ManaPool instances. Cast here is safe
  // for tests that seed the pool before calling CostMana.
  return player.manaPool as ManaPool;
}

export const CostMana: CostPart = {
  handlerKey: "Mana",

  canPay(ctx: CostPaymentContext): boolean {
    const cost = ManaCost.parse(ctx.raw);
    const pool = getPool(ctx);
    // M4 stub: any CMC-many shards satisfy the cost regardless of color.
    // M5 replaces with real color-aware constraint satisfaction.
    // Note: ManaCost.cmc() is a method (default xValue=0).
    return pool.size() >= cost.cmc();
  },

  // biome-ignore lint/correctness/useYield: ManaPool.drain is synchronous; no engine decisions needed
  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const cost = ManaCost.parse(ctx.raw);
    const pool = getPool(ctx);
    // cmc() is a method; default xValue=0 means X costs contribute 0 CMC
    // which is the M4 stub behavior (M5 will bind X from context).
    const cmc = cost.cmc();

    if (pool.size() < cmc) {
      throw new Error(
        `CostMana.pay: insufficient mana (need ${cmc}, have ${pool.size()}) for cost "${ctx.raw}"`,
      );
    }

    // Capture snapshot for undo. Then drain cmc shards from the pool by
    // restoring with the last (size - cmc) shards (i.e. remove the first
    // `cmc` shards — pool shards are FIFO from add()).
    const snap: ManaProduced[] = pool.snapshot();
    const consumed = snap.slice(0, cmc);
    const remaining = snap.slice(cmc);
    pool.restore(remaining);

    const cmcPaid = cmc; // keep local for payload clarity
    return {
      handlerKey: "Mana",
      raw: ctx.raw,
      // payload carries the pre-payment snapshot for full undo fidelity.
      payload: { cmc: cmcPaid, prePaymentSnapshot: snap, consumed },
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { prePaymentSnapshot } = receipt.payload as {
      cmc: number;
      prePaymentSnapshot: ManaProduced[];
      consumed: ManaProduced[];
    };
    const pool = getPool(ctx);
    pool.restore(prePaymentSnapshot);
  },
};

costPartRegistry.register(CostMana);

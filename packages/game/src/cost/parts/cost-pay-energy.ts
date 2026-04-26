// SPDX-License-Identifier: GPL-3.0-or-later
// CostPayEnergy — payment of "PayEnergy<n>" (Aether Revolt energy mechanic,
// CR 106.11). Energy counters live on the player (Player.counters with
// CounterType.Energy). pay deducts N energy directly; undo refunds them.
//
// Energy isn't routed through removeCounter / addCounter today — the
// proliferate codepath in game-action mutates Player.counters directly, and
// we mirror that pattern here. Replacement effects on energy spend are not
// part of the rules (energy isn't a card counter, and CR 106.11 has no
// replacement hook), so direct mutation is correct.
import { CounterType } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const PAY_ENERGY_RE = /^PayEnergy<(\d+)>$/;

const parseAmount = (raw: string): number => {
  const m = PAY_ENERGY_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostPayEnergy: cannot parse "${raw}"`);
  return Number.parseInt(m[1], 10);
};

interface PayEnergyReceipt {
  readonly seat: PlayerSeat;
  readonly amount: number;
}

export const CostPayEnergy: CostPart = {
  handlerKey: "PayEnergy",

  canPay(ctx: CostPaymentContext): boolean {
    const n = parseAmount(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    return (player.counters.get(CounterType.Energy) ?? 0) >= n;
  },

  // biome-ignore lint/correctness/useYield: energy spend has no canonical event today (CR 106.11 has no replacement hook)
  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const n = parseAmount(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    const have = player.counters.get(CounterType.Energy) ?? 0;
    if (have < n) {
      throw new Error(
        `CostPayEnergy.pay: insufficient energy (need ${n}, have ${have}) for cost "${ctx.raw}"`,
      );
    }
    const next = have - n;
    if (next <= 0) player.counters.delete(CounterType.Energy);
    else player.counters.set(CounterType.Energy, next);
    const receipt: PayEnergyReceipt = { seat: ctx.payerSeat, amount: n };
    return {
      handlerKey: "PayEnergy",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { seat, amount } = receipt.payload as PayEnergyReceipt;
    const player = ctx.game.getPlayer(seat);
    const cur = player.counters.get(CounterType.Energy) ?? 0;
    player.counters.set(CounterType.Energy, cur + amount);
  },
};

costPartRegistry.register(CostPayEnergy);

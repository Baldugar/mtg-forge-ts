// SPDX-License-Identifier: GPL-3.0-or-later
// CostDraw — payment of "Draw<n/who>". The controller draws N cards as a
// cost. Used by Smuggler's Copter's looter trigger (`Cost$ Draw<1/You>`),
// among others.
//
// The "who" segment is informational in cost contexts — the cost belongs to
// the activating player by definition (Forge encodes who as a sanity tag).
// We parse and ignore it; pay always draws for ctx.payerSeat. canPay verifies
// the player has at least N cards in their library (a deck-out mid-cost
// would otherwise illegally activate the ability).
//
// pay routes through game.action.drawCards which already runs the per-card
// replacement chain (so dredge, Thought Reflection, etc., still fire). undo
// is a no-op for the same reason as Mill — drawing is non-reversible at the
// cost layer.
import { ZoneType } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const DRAW_RE = /^Draw<(\d+)(?:\/[^>]*)?>$/;

const parseAmount = (raw: string): number => {
  const m = DRAW_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostDraw: cannot parse "${raw}"`);
  return Number.parseInt(m[1], 10);
};

interface DrawReceipt {
  readonly seat: PlayerSeat;
  readonly amount: number;
}

export const CostDraw: CostPart = {
  handlerKey: "Draw",

  canPay(ctx: CostPaymentContext): boolean {
    const n = parseAmount(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    const lib = player.zones.get(ZoneType.Library);
    return (lib?.size ?? 0) >= n;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const n = parseAmount(ctx.raw);
    yield* ctx.game.action.drawCards(ctx.payerSeat, n, { cause: "cost" });
    const receipt: DrawReceipt = { seat: ctx.payerSeat, amount: n };
    return {
      handlerKey: "Draw",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // Draws are non-reversible at the cost layer.
  },
};

costPartRegistry.register(CostDraw);

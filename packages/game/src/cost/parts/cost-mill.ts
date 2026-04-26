// SPDX-License-Identifier: GPL-3.0-or-later
// CostMill — payment of "Mill<n>" / "Mill<n/Filter>". The controller mills N
// cards from the top of their library (CR 701.13). Forge writes both
// `Mill<n>` and `Mill<n/Filter>`; the filter argument is informational —
// milling is always from top of library — so we accept either form and ignore
// any trailing filter.
//
// pay routes through game.action.mill which already runs replacement chains
// per-card and emits CardMilled events. undo is a no-op: mill irreversibly
// moves cards into the graveyard; in practice cost rollback before mill is
// the only safe path (other CostParts pay first).
import { ZoneType } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const MILL_RE = /^Mill<(\d+)(?:\/[^>]*)?>$/;

const parseAmount = (raw: string): number => {
  const m = MILL_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostMill: cannot parse "${raw}"`);
  return Number.parseInt(m[1], 10);
};

interface MillReceipt {
  readonly seat: PlayerSeat;
  readonly amount: number;
}

export const CostMill: CostPart = {
  handlerKey: "Mill",

  canPay(ctx: CostPaymentContext): boolean {
    const n = parseAmount(ctx.raw);
    const player = ctx.game.getPlayer(ctx.payerSeat);
    const lib = player.zones.get(ZoneType.Library);
    return (lib?.size ?? 0) >= n;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const n = parseAmount(ctx.raw);
    yield* ctx.game.action.mill(ctx.payerSeat, n);
    const receipt: MillReceipt = { seat: ctx.payerSeat, amount: n };
    return {
      handlerKey: "Mill",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // CardMilled events are non-reversible at this layer; callers must order
    // Mill late in the cost plan so other parts can roll back first.
  },
};

costPartRegistry.register(CostMill);

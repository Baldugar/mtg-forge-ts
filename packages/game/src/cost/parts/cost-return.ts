// SPDX-License-Identifier: GPL-3.0-or-later
// CostReturn — payment of "Return<n/Filter>". The controller returns N
// permanents they control matching <Filter> from the battlefield to their
// hand. Used by "bounce" activated abilities and any cost line of the form
// "as an additional cost, return N <type> you control to its owner's hand".
//
// canPay enumerates the controller's battlefield permanents matching the
// filter and verifies count >= n. pay yields a chooseCard decision and
// moves each chosen permanent to its owner's hand. undo is a no-op
// (zone-change events already emitted).
import { ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const RETURN_RE = /^Return<(\d+)\/(.+)>$/;

interface ParsedReturn {
  readonly amount: number;
  readonly filter: string;
}

const parseReturn = (raw: string): ParsedReturn => {
  const m = RETURN_RE.exec(raw);
  if (!m || !m[1] || !m[2]) throw new Error(`CostReturn: cannot parse "${raw}"`);
  return { amount: Number.parseInt(m[1], 10), filter: m[2] };
};

const enumerateEligible = (ctx: CostPaymentContext, filter: string): readonly EntityId[] => {
  const out: EntityId[] = [];
  const filterCtx = {
    controllerSeat: ctx.payerSeat,
    sourceCardId: ctx.sourceCardId,
  };
  for (const [id, c] of ctx.game.cards) {
    if (c.zone !== ZoneType.Battlefield) continue;
    if (c.controllerSeat !== ctx.payerSeat) continue;
    if (!cardMatchesFilter(c, filter, filterCtx)) continue;
    out.push(id);
  }
  return out;
};

interface ReturnReceipt {
  readonly cardIds: readonly EntityId[];
}

export const CostReturn: CostPart = {
  handlerKey: "Return",

  canPay(ctx: CostPaymentContext): boolean {
    const parsed = parseReturn(ctx.raw);
    return enumerateEligible(ctx, parsed.filter).length >= parsed.amount;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const parsed = parseReturn(ctx.raw);
    const eligible = enumerateEligible(ctx, parsed.filter);
    if (eligible.length < parsed.amount) {
      throw new Error(
        `CostReturn.pay: insufficient eligible permanents for "${ctx.raw}" (need ${parsed.amount}, have ${eligible.length})`,
      );
    }
    const decision = (yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: ctx.payerSeat,
        pool: eligible,
        restriction: { keyword: "return-cost", filter: parsed.filter },
        min: parsed.amount,
        max: parsed.amount,
      },
    }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
    const chosen = decision?.kind === "chooseCard" ? decision.chosen : [];
    if (chosen.length !== parsed.amount) {
      throw new Error(
        `CostReturn.pay: chose ${chosen.length} cards, expected ${parsed.amount} for "${ctx.raw}"`,
      );
    }
    const eligibleSet = new Set(eligible);
    for (const id of chosen) {
      if (!eligibleSet.has(id)) {
        throw new Error(`CostReturn.pay: chose ineligible card ${id} for "${ctx.raw}"`);
      }
      yield* ctx.game.action.moveTo(id, ZoneType.Hand, { cause: "return-cost" });
    }
    const receipt: ReturnReceipt = { cardIds: chosen };
    return { handlerKey: "Return", raw: ctx.raw, payload: receipt };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // moveTo zone-change events emitted; non-reversible at the cost layer.
  },
};

costPartRegistry.register(CostReturn);

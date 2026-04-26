// SPDX-License-Identifier: GPL-3.0-or-later
// CostTapType — payment of "tapXType<Filter>" or "tapNType<Filter>".
// The controller taps any number / N untapped permanents they control
// matching <Filter>. Forge writes both `tapX` (variable) and `tap<N>` (fixed)
// forms; we accept both.
//
// canPay enumerates eligible (untapped, controller's, on-battlefield, filter
// match) permanents and verifies count >= N (or >=1 for the X form). pay
// yields a chooseCard decision (min=N, max=N for fixed; min=0, max=eligible
// for X) and taps each chosen card directly via game.action.tap. The source
// card MAY be one of the chosen tapped cards (caller decides). undo restores
// the tapped flag directly.
import { ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

// `tapXType<Filter>` — variable count (X bound to total chosen, picked by
// player; min=0). `tapNType<Filter>` (any digit run) — fixed count.
const TAP_TYPE_RE = /^tap(X|\d+)Type<(.+)>$/;

interface ParsedTapType {
  /** Fixed amount, or null for the X (variable) form. */
  readonly amount: number | null;
  readonly filter: string;
}

const parseTapType = (raw: string): ParsedTapType => {
  const m = TAP_TYPE_RE.exec(raw);
  if (!m || !m[1] || !m[2]) throw new Error(`CostTapType: cannot parse "${raw}"`);
  if (m[1] === "X") return { amount: null, filter: m[2] };
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
    if (c.tapped) continue;
    if (!cardMatchesFilter(c, filter, filterCtx)) continue;
    out.push(id);
  }
  return out;
};

interface TapTypeReceipt {
  readonly cardIds: readonly EntityId[];
}

export const CostTapType: CostPart = {
  handlerKey: "TapType",

  canPay(ctx: CostPaymentContext): boolean {
    const parsed = parseTapType(ctx.raw);
    const eligible = enumerateEligible(ctx, parsed.filter);
    if (parsed.amount === null) return eligible.length >= 1;
    return eligible.length >= parsed.amount;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const parsed = parseTapType(ctx.raw);
    const eligible = enumerateEligible(ctx, parsed.filter);
    const minPick = parsed.amount ?? 1;
    if (eligible.length < minPick) {
      throw new Error(
        `CostTapType.pay: insufficient eligible permanents for "${ctx.raw}" (need ${minPick}, have ${eligible.length})`,
      );
    }
    const min = parsed.amount ?? 1;
    const max = parsed.amount ?? eligible.length;
    const decision = (yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: ctx.payerSeat,
        pool: eligible,
        restriction: { keyword: "tap-type-cost", filter: parsed.filter },
        min,
        max,
      },
    }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
    const chosen = decision?.kind === "chooseCard" ? decision.chosen : [];
    if (chosen.length < min || chosen.length > max) {
      throw new Error(
        `CostTapType.pay: chose ${chosen.length} cards, expected ${min}..${max} for "${ctx.raw}"`,
      );
    }
    const eligibleSet = new Set(eligible);
    for (const id of chosen) {
      if (!eligibleSet.has(id)) {
        throw new Error(`CostTapType.pay: chose ineligible card ${id} for "${ctx.raw}"`);
      }
      yield* ctx.game.action.tap(id);
    }
    const receipt: TapTypeReceipt = { cardIds: chosen };
    return { handlerKey: "TapType", raw: ctx.raw, payload: receipt };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { cardIds } = receipt.payload as TapTypeReceipt;
    for (const id of cardIds) {
      const c = ctx.game.cards.get(id);
      if (c) c.tapped = false;
    }
  },
};

costPartRegistry.register(CostTapType);

// SPDX-License-Identifier: GPL-3.0-or-later
// CostReveal — payment of "Reveal<n/Filter>". The controller reveals N cards
// from their hand matching <Filter>. Used for "as an additional cost,
// reveal a <type> card from your hand" mechanics (Conspire, Channel
// activated abilities that gate on revealing types, etc.).
//
// canPay enumerates the controller's hand for filter-matching cards and
// verifies count >= n. pay yields a chooseCard decision and emits a
// CardsRevealed event for the chosen set. The cards stay in hand. undo is
// a no-op (the reveal event has already fired and is observable).
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const REVEAL_RE = /^Reveal<(\d+)\/(.+)>$/;

interface ParsedReveal {
  readonly amount: number;
  readonly filter: string;
}

const parseReveal = (raw: string): ParsedReveal => {
  const m = REVEAL_RE.exec(raw);
  if (!m || !m[1] || !m[2]) throw new Error(`CostReveal: cannot parse "${raw}"`);
  return { amount: Number.parseInt(m[1], 10), filter: m[2] };
};

const isAnyCardFilter = (filter: string): boolean => filter === "Card" || filter === "Any" || filter === "*";

const enumerateEligibleHand = (ctx: CostPaymentContext, filter: string): readonly EntityId[] => {
  const out: EntityId[] = [];
  const filterCtx = {
    controllerSeat: ctx.payerSeat,
    sourceCardId: ctx.sourceCardId,
  };
  const player = ctx.game.getPlayer(ctx.payerSeat);
  const hand = player.zones.get(ZoneType.Hand);
  if (!hand) return out;
  for (const id of hand.toArray()) {
    const c = ctx.game.cards.get(id);
    if (!c) continue;
    if (isAnyCardFilter(filter) || cardMatchesFilter(c, filter, filterCtx)) out.push(id);
  }
  return out;
};

interface RevealReceipt {
  readonly cardIds: readonly EntityId[];
  readonly seat: PlayerSeat;
}

export const CostReveal: CostPart = {
  handlerKey: "Reveal",

  canPay(ctx: CostPaymentContext): boolean {
    const parsed = parseReveal(ctx.raw);
    return enumerateEligibleHand(ctx, parsed.filter).length >= parsed.amount;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const parsed = parseReveal(ctx.raw);
    const eligible = enumerateEligibleHand(ctx, parsed.filter);
    if (eligible.length < parsed.amount) {
      throw new Error(
        `CostReveal.pay: insufficient eligible hand cards for "${ctx.raw}" (need ${parsed.amount}, have ${eligible.length})`,
      );
    }
    const decision = (yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: ctx.payerSeat,
        pool: eligible,
        restriction: { keyword: "reveal-cost", filter: parsed.filter },
        min: parsed.amount,
        max: parsed.amount,
      },
    }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
    const chosen = decision?.kind === "chooseCard" ? decision.chosen : [];
    if (chosen.length !== parsed.amount) {
      throw new Error(
        `CostReveal.pay: chose ${chosen.length} cards, expected ${parsed.amount} for "${ctx.raw}"`,
      );
    }
    const eligibleSet = new Set(eligible);
    for (const id of chosen) {
      if (!eligibleSet.has(id)) {
        throw new Error(`CostReveal.pay: chose ineligible card ${id} for "${ctx.raw}"`);
      }
    }
    yield ctx.game.emitEvent(
      mkEvent("CardsRevealed", ctx.game.turn, ctx.game.phase, {
        revealedBy: ctx.payerSeat,
        revealedTo: "all",
        cardIds: chosen,
        fromZone: ZoneType.Hand,
      }),
    );
    const receipt: RevealReceipt = { cardIds: chosen, seat: ctx.payerSeat };
    return { handlerKey: "Reveal", raw: ctx.raw, payload: receipt };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // CardsRevealed is observational — cannot un-reveal.
  },
};

costPartRegistry.register(CostReveal);

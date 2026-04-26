// SPDX-License-Identifier: GPL-3.0-or-later
// CostRemoveCounter — payment of a "SubCounter<n/Type>" cost.
//
// Forge DSL form: `SubCounter<n/Type>` — used for every planeswalker negative
// activated ability (e.g. Jace, the Mind Sculptor's `-1: Return target creature
// to its owner's hand` decomposes to `Cost$ SubCounter<1/LOYALTY>`), plus
// generic counter-removal activations (Walking Ballista's
// `Cost$ SubCounter<1/P1P1>` damage ability, Spike Hatcher, etc.).
//
// canPay verifies the source card exists AND has at least N counters of the
// requested kind. pay routes through game.action.removeCounter so the
// replacement chain (and CounterRemoved event) fires. undo restores the
// counters directly without re-emitting events.
import type { EntityId } from "@mtg-forge-ts/core";
import type { CounterType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";
import { parseCounterTypeToken } from "./cost-put-counter.js";

const SUB_COUNTER_RE = /^SubCounter<(\d+)\/([\w+\-/]+)>$/;

interface ParsedCounterCost {
  readonly amount: number;
  readonly counterType: CounterType;
}

const parseSubCounter = (raw: string): ParsedCounterCost => {
  const m = SUB_COUNTER_RE.exec(raw);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`CostRemoveCounter: cannot parse "${raw}"`);
  }
  const amount = Number.parseInt(m[1], 10);
  const ct = parseCounterTypeToken(m[2]);
  if (ct === undefined) {
    throw new Error(`CostRemoveCounter: unknown counter type "${m[2]}" in "${raw}"`);
  }
  return { amount, counterType: ct };
};

interface RemoveCounterReceipt {
  readonly cardId: EntityId;
  readonly counterType: CounterType;
  readonly amount: number;
}

export const CostRemoveCounter: CostPart = {
  handlerKey: "RemoveCounter",

  canPay(ctx: CostPaymentContext): boolean {
    const { amount, counterType } = parseSubCounter(ctx.raw);
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return false;
    const have = card.counters.get(counterType) ?? 0;
    return have >= amount;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const { amount, counterType } = parseSubCounter(ctx.raw);
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) {
      throw new Error(`CostRemoveCounter.pay: no card with id ${ctx.sourceCardId}`);
    }
    const have = card.counters.get(counterType) ?? 0;
    if (have < amount) {
      throw new Error(
        `CostRemoveCounter.pay: insufficient ${counterType} counters on ${ctx.sourceCardId} (need ${amount}, have ${have})`,
      );
    }
    yield* ctx.game.action.removeCounter(ctx.sourceCardId, counterType, amount, ctx.sourceCardId);
    const receipt: RemoveCounterReceipt = {
      cardId: ctx.sourceCardId,
      counterType,
      amount,
    };
    return {
      handlerKey: "RemoveCounter",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { cardId, counterType, amount } = receipt.payload as RemoveCounterReceipt;
    const card = ctx.game.cards.get(cardId);
    if (!card) return;
    const cur = card.counters.get(counterType) ?? 0;
    card.counters.set(counterType, cur + amount);
  },
};

costPartRegistry.register(CostRemoveCounter);

// SPDX-License-Identifier: GPL-3.0-or-later
// CostPutCounter — payment of an "AddCounter<n/Type>" cost.
//
// Forge DSL form: `AddCounter<n/Type>` — used for every planeswalker positive
// activated ability (e.g. Jace, the Mind Sculptor's `+2: Look at the top card
// of target player's library` decomposes to `Cost$ AddCounter<2/LOYALTY>`),
// plus generic counter-cost activated abilities (Spike Hatcher, charge counter
// activations, etc.).
//
// The cost puts N counters of the given type on the SOURCE card. The cost is
// payable as long as the source card exists in a zone we can address (canPay
// is intentionally permissive — replacement effects might cancel the addition,
// but that surfaces inside pay()).
//
// Uppercase `LOYALTY` (Forge's planeswalker shorthand) maps to
// CounterType.Loyalty. All other type tokens are looked up against the
// CounterType enum by exact lowercase value (matching Forge's enum string
// names); unknown tokens fall back to Charge counters with a warning, mirroring
// Forge's relaxed parsing.
import type { EntityId } from "@mtg-forge-ts/core";
import { CounterType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const ADD_COUNTER_RE = /^AddCounter<(\d+)\/([\w+\-/]+)>$/;

interface ParsedCounterCost {
  readonly amount: number;
  readonly counterType: CounterType;
}

/**
 * Map a Forge counter-type token (case-insensitive) to a CounterType enum
 * value. Returns undefined for unrecognised tokens so the caller can decide
 * whether to throw or fall back.
 */
export const parseCounterTypeToken = (token: string): CounterType | undefined => {
  // Forge writes planeswalker counters as `LOYALTY` (uppercase). Several
  // other counter kinds use shorthand uppercase forms in Forge cardsfolder
  // (e.g. `P1P1` for `+1/+1`, `M1M1` for `-1/-1`). We accept both.
  const upper = token.toUpperCase();
  if (upper === "LOYALTY") return CounterType.Loyalty;
  if (upper === "P1P1") return CounterType.PlusOnePlusOne;
  if (upper === "M1M1") return CounterType.MinusOneMinusOne;
  if (upper === "CHARGE") return CounterType.Charge;
  // Lowercase enum-string lookup ("loyalty", "charge", etc.).
  const lower = token.toLowerCase();
  for (const ct of Object.values(CounterType)) {
    if (ct === lower) return ct;
  }
  return undefined;
};

const parseAddCounter = (raw: string): ParsedCounterCost => {
  const m = ADD_COUNTER_RE.exec(raw);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`CostPutCounter: cannot parse "${raw}"`);
  }
  const amount = Number.parseInt(m[1], 10);
  const ct = parseCounterTypeToken(m[2]);
  if (ct === undefined) {
    throw new Error(`CostPutCounter: unknown counter type "${m[2]}" in "${raw}"`);
  }
  return { amount, counterType: ct };
};

interface PutCounterReceipt {
  readonly cardId: EntityId;
  readonly counterType: CounterType;
  readonly amount: number;
}

export const CostPutCounter: CostPart = {
  handlerKey: "PutCounter",

  canPay(ctx: CostPaymentContext): boolean {
    parseAddCounter(ctx.raw); // validates parsing
    const card = ctx.game.cards.get(ctx.sourceCardId);
    return card !== undefined;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const { amount, counterType } = parseAddCounter(ctx.raw);
    yield* ctx.game.action.addCounter(ctx.sourceCardId, counterType, amount, ctx.sourceCardId);
    const receipt: PutCounterReceipt = {
      cardId: ctx.sourceCardId,
      counterType,
      amount,
    };
    return {
      handlerKey: "PutCounter",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { cardId, counterType, amount } = receipt.payload as PutCounterReceipt;
    // Direct mutation for rollback — no event, no replacement chain.
    const card = ctx.game.cards.get(cardId);
    if (!card) return;
    const cur = card.counters.get(counterType) ?? 0;
    const next = cur - amount;
    if (next <= 0) card.counters.delete(counterType);
    else card.counters.set(counterType, next);
  },
};

costPartRegistry.register(CostPutCounter);

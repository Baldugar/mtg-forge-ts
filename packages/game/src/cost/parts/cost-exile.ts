// SPDX-License-Identifier: GPL-3.0-or-later
// CostExile — generalised "Exile<n/Filter>" / "ExileFromHand<n/Filter>" /
// "ExileFromGrave<n/Filter>" / "ExileFromTop<n/Filter>" cost.
//
// The handlerKey is mapped at parseCostString time, so each zone gets its own
// CostPart instance with the same shape but a different default eligible-zone.
// This avoids stuffing zone routing into every CostPart.canPay/pay body.
//
// canPay enumerates eligible cards (zone match + filter match if filter !=
// CARDNAME/Self) and verifies count >= n. pay yields a chooseCard decision
// (min=N, max=N, pool=eligible) and moves each chosen card to Exile.
//
// Filter grammar reuses Wave 32's cardMatchesFilter (comma-OR / dot-AND).
// CARDNAME / Self are treated as a self-only literal (no decision yielded —
// the source is auto-selected). For ExileFromTop the cards are picked
// off the top of the controller's library (no decision is shown to the
// player; CR 701.20 says "exile the top N cards").
import { ZoneType } from "@mtg-forge-ts/core";
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const EXILE_RE = /^Exile<(\d+)\/(.+)>$/;
const EXILE_FROM_HAND_RE = /^ExileFromHand<(\d+)\/(.+)>$/;
const EXILE_FROM_GRAVE_RE = /^ExileFromGrave<(\d+)\/(.+)>$/;
const EXILE_FROM_TOP_RE = /^ExileFromTop<(\d+)\/(.+)>$/;

interface ParsedExile {
  readonly amount: number;
  readonly filter: string;
  readonly zone: ZoneType;
}

const isSelfFilter = (filter: string): boolean => {
  const t = filter.trim();
  return t === "CARDNAME" || t === "Self" || t === "this card";
};

const parseExile = (raw: string): ParsedExile => {
  let m = EXILE_RE.exec(raw);
  if (m) return { amount: Number.parseInt(m[1] ?? "0", 10), filter: m[2] ?? "", zone: ZoneType.Battlefield };
  m = EXILE_FROM_HAND_RE.exec(raw);
  if (m) return { amount: Number.parseInt(m[1] ?? "0", 10), filter: m[2] ?? "", zone: ZoneType.Hand };
  m = EXILE_FROM_GRAVE_RE.exec(raw);
  if (m) return { amount: Number.parseInt(m[1] ?? "0", 10), filter: m[2] ?? "", zone: ZoneType.Graveyard };
  m = EXILE_FROM_TOP_RE.exec(raw);
  if (m) return { amount: Number.parseInt(m[1] ?? "0", 10), filter: m[2] ?? "", zone: ZoneType.Library };
  // Bare "ExileFromGrave" (no <...>) — legacy self-only path; treated as
  // amount=1 / filter=CARDNAME / zone=Graveyard.
  if (/^ExileFromGrave$/i.test(raw)) {
    return { amount: 1, filter: "CARDNAME", zone: ZoneType.Graveyard };
  }
  throw new Error(`CostExile: cannot parse "${raw}"`);
};

const enumerateEligible = (ctx: CostPaymentContext, parsed: ParsedExile): readonly EntityId[] => {
  if (isSelfFilter(parsed.filter)) {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return [];
    if (card.zone !== parsed.zone) return [];
    return [card.id];
  }
  const out: EntityId[] = [];
  const filterCtx = {
    controllerSeat: ctx.payerSeat,
    sourceCardId: ctx.sourceCardId,
  };
  for (const [id, c] of ctx.game.cards) {
    if (c.zone !== parsed.zone) continue;
    // For Hand/Graveyard, restrict to the payer's own zone (you can only
    // exile from YOUR hand / YOUR graveyard for cost purposes).
    if (parsed.zone === ZoneType.Hand && c.ownerSeat !== ctx.payerSeat) continue;
    if (parsed.zone === ZoneType.Graveyard && c.ownerSeat !== ctx.payerSeat) continue;
    if (parsed.zone === ZoneType.Library && c.ownerSeat !== ctx.payerSeat) continue;
    if (!cardMatchesFilter(c, parsed.filter, filterCtx)) continue;
    out.push(id);
  }
  return out;
};

interface ExileReceipt {
  readonly cardIds: readonly EntityId[];
  readonly originSeats: readonly PlayerSeat[];
  readonly originZone: ZoneType;
}

export const CostExile: CostPart = {
  handlerKey: "Exile",

  canPay(ctx: CostPaymentContext): boolean {
    const parsed = parseExile(ctx.raw);
    if (parsed.zone === ZoneType.Library) {
      // ExileFromTop never asks the player; verify enough cards on top.
      const lib = ctx.game.getPlayer(ctx.payerSeat).zones.get(ZoneType.Library);
      return (lib?.size ?? 0) >= parsed.amount;
    }
    const eligible = enumerateEligible(ctx, parsed);
    return eligible.length >= parsed.amount;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const parsed = parseExile(ctx.raw);

    // ExileFromTop: top-of-library N cards, no decision needed.
    if (parsed.zone === ZoneType.Library) {
      const player = ctx.game.getPlayer(ctx.payerSeat);
      const lib = player.zones.get(ZoneType.Library);
      if (!lib || lib.size < parsed.amount) {
        throw new Error(`CostExile.pay: insufficient library size for "${ctx.raw}"`);
      }
      const ids: EntityId[] = [];
      for (let i = 0; i < parsed.amount; i++) {
        const id = lib.peekAt(0);
        if (id === undefined) break;
        yield* ctx.game.action.moveTo(id, ZoneType.Exile, { cause: "exile-cost" });
        ids.push(id);
      }
      const receipt: ExileReceipt = {
        cardIds: ids,
        originSeats: ids.map(() => ctx.payerSeat),
        originZone: ZoneType.Library,
      };
      return { handlerKey: "Exile", raw: ctx.raw, payload: receipt };
    }

    // Self-filter: skip the decision and exile the source itself.
    if (isSelfFilter(parsed.filter)) {
      const card = ctx.game.cards.get(ctx.sourceCardId);
      if (!card || card.zone !== parsed.zone) {
        throw new Error(
          `CostExile.pay: source ${ctx.sourceCardId} not in zone ${parsed.zone} for "${ctx.raw}"`,
        );
      }
      yield* ctx.game.action.moveTo(card.id, ZoneType.Exile, { cause: "exile-cost" });
      const receipt: ExileReceipt = {
        cardIds: [card.id],
        originSeats: [card.ownerSeat],
        originZone: parsed.zone,
      };
      return { handlerKey: "Exile", raw: ctx.raw, payload: receipt };
    }

    // Filter form: ask the player to pick N cards.
    const eligible = enumerateEligible(ctx, parsed);
    if (eligible.length < parsed.amount) {
      throw new Error(
        `CostExile.pay: insufficient eligible cards for "${ctx.raw}" (need ${parsed.amount}, have ${eligible.length})`,
      );
    }
    const decision = (yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: ctx.payerSeat,
        pool: eligible,
        restriction: { keyword: "exile-cost", filter: parsed.filter, zone: parsed.zone },
        min: parsed.amount,
        max: parsed.amount,
      },
    }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

    const chosen = decision?.kind === "chooseCard" ? decision.chosen : [];
    if (chosen.length !== parsed.amount) {
      throw new Error(
        `CostExile.pay: chose ${chosen.length} cards, expected ${parsed.amount} for "${ctx.raw}"`,
      );
    }
    const eligibleSet = new Set(eligible);
    const seats: PlayerSeat[] = [];
    for (const id of chosen) {
      if (!eligibleSet.has(id)) {
        throw new Error(`CostExile.pay: chose ineligible card ${id} for "${ctx.raw}"`);
      }
      const c = ctx.game.cards.get(id);
      if (!c) continue;
      seats.push(c.ownerSeat);
      yield* ctx.game.action.moveTo(id, ZoneType.Exile, { cause: "exile-cost" });
    }
    const receipt: ExileReceipt = {
      cardIds: chosen,
      originSeats: seats,
      originZone: parsed.zone,
    };
    return { handlerKey: "Exile", raw: ctx.raw, payload: receipt };
  },

  undo(_receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // moveTo to Exile is non-reversible at the cost layer (events emitted).
    // Callers must order CostExile late so other parts roll back first.
  },
};

costPartRegistry.register(CostExile);

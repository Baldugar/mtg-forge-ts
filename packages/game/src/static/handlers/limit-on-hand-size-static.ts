// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.D — LimitOnHandSize static handler. Overrides a player's max
// hand size at the cleanup step (CR 402.2). Examples:
//
//   S:Mode$ LimitOnHandSize | ValidPlayer$ You | Amount$ Unlimited
//     (Reliquary Tower / Spellbook / Library of Leng / Thought Vessel)
//   S:Mode$ LimitOnHandSize | ValidPlayer$ You | Amount$ 10
//     (literal cap shape — rare; some emblems / set hand size to a value)
//
// What it does (Forge): the cleanup-step "discard down to max hand size"
// turn-based action consults the lowest active LimitOnHandSize-derived
// cap for each player. "Amount$ Unlimited" returns POSITIVE_INFINITY so
// no discard fires.
//
// Routing: ruleChanging category. The static stamps a payload that the
// `effectiveMaxHandSize(game, seat)` query helper reads. The cleanup
// step reads that helper instead of the hard-coded 7.
//
// Subject conventions:
//   - ValidPlayer$ You / Opponent / Any / Player → handled by
//     buildPlayerPredicate (Wave 50 grammar).
//   - Amount$ Unlimited      → POSITIVE_INFINITY
//   - Amount$ <integer>      → that integer
//   - Amount$ +N / -N        → // TODO(advanced) arithmetic modifiers.
//     The MVP rejects these (returns 7) — most Forge cards use Unlimited
//     or a literal value.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

// Payload exposes the predicate + amount; the gate consumer
// (effectiveMaxHandSize) walks the registry and combines per-seat.
export interface LimitOnHandSizePayload {
  readonly kind: "limitOnHandSize";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  readonly amount: number; // POSITIVE_INFINITY for "Unlimited"
  // Whether the static specified a *modifier* form (+N / -N). MVP does
  // not consume this for arithmetic combination; reserved for follow-up.
  readonly isAdditive: boolean;
}

const parseAmount = (raw: string | undefined): { amount: number; isAdditive: boolean } => {
  if (raw === undefined || raw.length === 0) return { amount: Number.POSITIVE_INFINITY, isAdditive: false };
  if (raw === "Unlimited") return { amount: Number.POSITIVE_INFINITY, isAdditive: false };
  // TODO(advanced) — Forge supports +N / -N modifier forms (rare; some
  // emblems and "your maximum hand size is increased by 1" cards). MVP
  // marks them as additive but parses the absolute count; the consumer
  // ignores the additive flag for now.
  if (raw.startsWith("+") || raw.startsWith("-")) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return { amount: n, isAdditive: true };
    return { amount: 7, isAdditive: false };
  }
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n)) return { amount: n, isAdditive: false };
  return { amount: 7, isAdditive: false };
};

export class LimitOnHandSizeStaticHandler extends StaticHandler {
  static override readonly mode = "LimitOnHandSize" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const amountRaw = literalRaw(params.Amount);

    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const { amount, isAdditive } = parseAmount(amountRaw);

    const payload: LimitOnHandSizePayload = {
      kind: "limitOnHandSize",
      playerMatches: (seat) => seatPred(seat),
      amount,
      isAdditive,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "LimitOnHandSize",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(LimitOnHandSizeStaticHandler);

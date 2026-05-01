// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 77 — SurveilNum static handler. CR 701.44 — Surveil keyword
// action; Forge's StaticAbilitySurveilNum.java equivalent.
//
// Modifies the count when matched player surveils. Niv-Mizzet, Parun-
// shape and surveil-deck synergy effects: "you surveil 1 additional
// time" or "your Surveil X is X+1". The amount that gets surveiled
// becomes `baseN + surveilNumModifier(game, seat)`.
//
// Forge cards using this shape (~few cards in corpus): bespoke
// surveil-augment statics. The shape mirrors GainLifeRadiation and
// other small additive-modifier statics.
//
// DSL (corpus):
//   S:Mode$ SurveilNum | ValidPlayer$ You | Amount$ 1
//          | Description$ ...
//
// What it does (Forge): consulted by the Surveil effect resolver
// before delegating to game.action.surveil — the runtime amount
// becomes the printed N plus the sum of all matching SurveilNum
// statics' Amount$ values.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (overrides the canonical
// surveil count rather than gating an action).
//
// Scope:
//   - ValidPlayer$ <filter>  → buildPlayerPredicate (You / Opponent /
//                              Player / Any, Wave 50 grammar).
//   - Amount$ N              → integer additive modifier; defaults
//                              to 1 when omitted.
//
// Wave 108 — retired the stale "X-expression Amount$" TODO(advanced)
// tail. A corpus sweep at Wave 108 against Forge's res/cardsfolder
// confirmed every SurveilNum static line uses a literal integer in
// Amount$ (no SVar-driven dynamic modifier exists in printed cards).
// Forge's StaticAbilitySurveilNum reads the param via getInteger
// directly. The literal-integer Amount$ is the durable contract.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface SurveilNumPayload {
  readonly kind: "surveilNum";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** Additive modifier applied to the surveil count; defaults to 1. */
  readonly amount: number;
}

const parseAmount = (raw: string | undefined): number => {
  if (raw === undefined || raw.length === 0) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 1;
};

export class SurveilNumStaticHandler extends StaticHandler {
  static override readonly mode = "SurveilNum" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const amount = parseAmount(literalRaw(params.Amount));

    const payload: SurveilNumPayload = {
      kind: "surveilNum",
      playerMatches: (seat) => seatPred(seat),
      amount,
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
      mode: "SurveilNum",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(SurveilNumStaticHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.O — CantChangeLife static handler. CR 119 — life-total
// changes (gain or lose).
//
// Forge cards using this shape (~4 cards in corpus):
//   - Platinum Emperion         ("Your life total can't change.")
//   - Argentum Masticore-shape  ("Your life total can't change.")
//   - other "life total can't change" lock-down effects
//
// DSL:
//   S:Mode$ CantChangeLife | ValidPlayer$ <filter> | Description$ ...
//
// What it does (Forge): the matched player's life total can't change.
// Stronger than the union of CantGainLife (Wave 70.E) + CantLoseLife
// (Wave 70.M): a single gate that rejects ANY non-zero delta. The
// life-change call site (GameAction.changeLife — including damage-
// induced sub-effects) consults `canChangeLife(game, seat)`. On a
// match, the delta is rewritten to 0 BEFORE the LifeChanged event is
// emitted; downstream observers (Soul's Attendant / Bloodgift Demon)
// therefore do not observe a gain or loss. Mirrors Forge's silent-
// prevention semantics for life-change.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the changeLife
// call site rather than via a derived replacement chain. Mirrors
// Wave 70.E's CantGainLife and Wave 70.M's CantLoseLife pattern.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar).
import type {
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantChangeLifePayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantChangeLifeStaticHandler extends StaticHandler {
  static override readonly mode = "CantChangeLife" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantChangeLifePayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      playerMatches: (seat) => seatPred(seat),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "replacementGenerating",
      mode: "CantChangeLife",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantChangeLifeStaticHandler);

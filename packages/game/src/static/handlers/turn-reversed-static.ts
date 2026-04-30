// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — TurnReversed static handler. CR 103.7 — turn order.
//
// Forge cards using this shape (~1 card in corpus):
//   - Topsy Turvy (with CheckSVar$ X | SVarCompare$ GT2 — "as long as
//                  there are more than two players in the game, the
//                  turn order is reversed.")
//
// DSL (corpus):
//   S:Mode$ TurnReversed | ValidPlayer$ Player
//                        | CheckSVar$ X | SVarCompare$ GT2
//                        | Description$ ...
//
// What it does (Forge): consulted at the turn-order advance site (the
// "next active player after this turn" computation). When matched,
// turn order reverses — instead of seat N+1, the active seat advances
// to seat N-1 (mod player count). The CheckSVar$ guard restricts to
// 3+ player tables.
//
// Routing: ruleChanging per MODE_TO_CATEGORY. Pure rule override
// consulted by the turn-advance path.
//
// MVP scope: registration + helper. The consumer wiring (turn-order
// reversal at PhaseHandler.advanceActiveSeat / equivalent) is a
// TODO(advanced) — the engine's multi-player turn-order machinery is
// SP4 scope. The handler stamps the gate so future wiring reads it
// uniformly via `isTurnOrderReversed(game)`.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface TurnReversedPayload {
  readonly kind: "turnReversed";
  /**
   * True iff `seat` is the seat whose turn-order direction the gate
   * affects. Topsy Turvy uses ValidPlayer$ Player (every seat); future
   * cards may scope it.
   */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class TurnReversedStaticHandler extends StaticHandler {
  static override readonly mode = "TurnReversed" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: TurnReversedPayload = {
      kind: "turnReversed",
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
      category: "ruleChanging",
      mode: "TurnReversed",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(TurnReversedStaticHandler);

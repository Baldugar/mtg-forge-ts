// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — CanExhaust static handler. CR ??? — Edge of Eternities
// "Exhaust" mechanic: "Activate each exhaust ability only once."
// Forge's StaticAbilityExhaust.java equivalent.
//
// Forge cards using this:
//   - Elvish Refueler (EOE) — "During your turn, as long as you
//                                haven't activated an exhaust ability
//                                this turn, you may activate exhaust
//                                abilities as though they haven't
//                                been activated."
//
// DSL (corpus):
//   S:Mode$ CanExhaust | ValidPlayer$ You | PlayerTurn$ You
//          | CheckSVar$ X | SVarCompare$ LT1
//          | Description$ ...
//
// What it does (Forge): consulted at the exhaust-ability activation
// site. When ValidPlayer$ matches the activator, the per-creature
// "this exhaust ability has already been activated" gate is bypassed
// — the player may activate the same exhaust ability a second time.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (Forge canonical
// category; it overrides the canonical exhaust rule).
//
// MVP scope: forward-compat stub.  Our codebase has no Exhaust
// keyword infrastructure yet — there is no per-card
// `exhaustedThisTurn` flag, no Exhaust activation cost gate, and no
// keyword handler for K:Exhaust. The static still registers (so
// ports of cards with this S: line don't break the parser) and the
// `canReExhaust` helper is exposed so the future Exhaust pipeline
// can read it uniformly. TODO(advanced) — wire into the Exhaust
// activation gate once the Exhaust keyword lands.
//
// Build-time scope:
//   - ValidPlayer$ <filter> via buildPlayerPredicate (You / Opponent
//     / Any / Player).
// TODO(advanced):
//   - PlayerTurn$ <filter> — restricts to the matched player's own
//     turn.
//   - CheckSVar$ + SVarCompare$ — the per-turn activation count
//     gate. Elvish Refueler's full fidelity needs the SVar reader
//     (Count$ThisTurnActivated_Activated.Exhaust+YouCtrl).
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CanExhaustPayload {
  readonly kind: "canExhaust";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CanExhaustStaticHandler extends StaticHandler {
  static override readonly mode = "CanExhaust" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CanExhaustPayload = {
      kind: "canExhaust",
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
      mode: "CanExhaust",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CanExhaustStaticHandler);

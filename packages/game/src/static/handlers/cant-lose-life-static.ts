// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.M — CantLoseLife static handler. CR 119 — life-loss
// prevention. Mirror of Wave 70.E's CantGainLife on the negative-delta
// side: when the matched player would lose life, the loss is rewritten
// to 0 BEFORE the LifeChanged event fires.
//
// Forge cards using this (2 cards in corpus):
//   - Courageous Resolve  ("Until end of turn, you don't lose the
//                            game, and your opponents can't lose life.")
//                          (the "your opponents can't lose life" half
//                           is the negative gate; the LoseGame half is
//                           a separate replacement)
//   - Everybody Lives!    ("Each player's life total becomes 1, then
//                            until end of turn, players can't lose
//                            life.")
//
// DSL examples (corpus):
//   SVar:STKeepLife: Mode$ CantLoseLife | ValidPlayer$ You
//   SVar:STKeepLife: Mode$ CantLoseLife | ValidPlayer$ Player
//
// What it does (Forge): the matched player can't lose life. The
// life-change call site (GameAction.changeLife with negative delta —
// including damage-induced sub-effects) consults
// `canLoseLife(game, seat)`. On a match, the negative delta is
// rewritten to 0 BEFORE the LifeChanged event is emitted; downstream
// observers (Bloodgift Demon / Punishing Fire / Vampire Nighthawk)
// therefore do not observe a loss. Mirrors Forge's silent-prevention
// semantics for life-loss.
//
// Routing: replacementGenerating category — already mapped in
// MODE_TO_CATEGORY. The replacements list is empty; the gate is
// enforced at the changeLife call site rather than via a derived
// replacement chain. Mirrors Wave 70.E's CantGainLife pattern.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). Source-conditional sub-filters
// (CantLoseLifeFromSource$ Card.X) are TODO(advanced).
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

export interface CantLoseLifePayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantLoseLifeStaticHandler extends StaticHandler {
  static override readonly mode = "CantLoseLife" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantLoseLifePayload = {
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
      mode: "CantLoseLife",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantLoseLifeStaticHandler);

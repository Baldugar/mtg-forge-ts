// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.I — CantDraw static handler. CR 121.1 — draw prevention.
// Forge cards using this:
//   - Underworld Dreams analogues   (in some shapes the trigger gates on
//                                     a player drawing cards, but the
//                                     direct CantDraw form mirrors
//                                     Curse-of-the-Forsaken / Megrim-
//                                     adjacent permanents)
//   - Black Vise effects            (player can't draw extra cards)
//   - Curse of the Forsaken         (curse: enchanted player can't draw
//                                     additional cards beyond their first
//                                     each turn — the static form drops
//                                     the conditional and gates ALL draws
//                                     for the cursed player)
//   - Howling Mine inverse cards    (direct "you can't draw cards" form)
//
// DSL:
//   S:Mode$ CantDraw | ValidPlayer$ Player    | Description$ ...
//   S:Mode$ CantDraw | ValidPlayer$ Opponent  | Description$ ...
//   S:Mode$ CantDraw | ValidPlayer$ You       | Description$ ...
//
// What it does (Forge): the matched player can't draw cards. Per CR 121.5,
// "if an effect causes a player to draw 0 cards, no cards are drawn" —
// the gate on a positive draw count rewrites the per-card draw loop to a
// no-op for the matched seat. No CardDrawn event fires; the
// cardsDrawnThisTurn tracker is unchanged; library state is unchanged.
//
// Routing: replacementGenerating category — already mapped in
// MODE_TO_CATEGORY (alongside the rest of the Cant* family). The
// replacements list is empty; the gate is enforced at the GameAction
// .drawCards call site rather than via a derived replacement chain.
// Mirrors Wave 70.E's CantGainLife pattern: silent short-circuit before
// applyWithReplacements runs.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). Wave 97 closes the count-conditional
// CantDrawByCount$ N sub-filter — the gate fires only after the matched
// player has already drawn N cards this turn. Combines with
// `cardsDrawnThisTurn` tracker (game-flags) so each per-card draw is
// gated against the live count.
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

export interface CantDrawPayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * Wave 97 — CantDrawByCount$ N parameter. When undefined, the gate is
   * unconditional (canonical pre-Wave-97 behavior). When set, the gate
   * fires only after the matched player has drawn AT LEAST N cards this
   * turn — i.e. the (N+1)-th draw and onward are blocked. The 0 case
   * matches "can't draw any cards" which is the unconditional shape.
   */
  readonly byCount: number | undefined;
}

export class CantDrawStaticHandler extends StaticHandler {
  static override readonly mode = "CantDraw" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    // Wave 97 — optional count threshold. Negative / non-integer values
    // are coerced to undefined so a malformed script doesn't silently
    // change the gate's semantics.
    const byCountRaw = literalRaw(params.CantDrawByCount);
    let byCount: number | undefined;
    if (byCountRaw !== undefined) {
      const n = Number.parseInt(byCountRaw, 10);
      if (Number.isFinite(n) && n >= 0) byCount = n;
    }

    const payload: CantDrawPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      playerMatches: (seat) => seatPred(seat),
      byCount,
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
      mode: "CantDraw",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantDrawStaticHandler);

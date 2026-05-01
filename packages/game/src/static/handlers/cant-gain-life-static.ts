// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.E — CantGainLife static handler. CR 119 — life-gain prevention.
// Forge cards using this:
//   - Erebos, God of the Dead       (Your opponents can't gain life)
//   - Yasharn, Implacable Earth     (paired with sacrifice gate)
//   - Sulfuric Vortex               (players can't gain life — each player)
//   - Roiling Vortex                (each player can't gain life)
//   - Stigma Lasher                 (players can't gain life)
//   - Rampaging Ferocidon           (players can't gain life)
//
// DSL:
//   S:Mode$ CantGainLife | ValidPlayer$ Player    | Description$ ...
//   S:Mode$ CantGainLife | ValidPlayer$ Opponent  | Description$ ...
//   S:Mode$ CantGainLife | ValidPlayer$ You       | Description$ ...
//
// What it does (Forge): the matched player can't gain life. The life-gain
// call site (GameAction.changeLife with positive delta — including damage-
// induced "Soul Sister" gainLife sub-effects) consults
// `canGainLife(game, seat)`. On a match, the positive delta is rewritten
// to 0 BEFORE the LifeChanged event is emitted; downstream observers
// (Soul's Attendant / Ajani's Pridemate / Crested Sunmare) therefore do
// not observe a gain. Mirrors Forge's silent-prevention semantics for
// life-gain (the LifeChanged event still fires but with delta 0, so SBA
// bookkeeping stays consistent with the post-state — the player's life
// total is unchanged).
//
// Routing: replacementGenerating category — already mapped in
// MODE_TO_CATEGORY. The replacements list is empty; the gate is enforced
// at the changeLife call site rather than via a derived replacement
// chain. Mirrors Wave 60.E's prevent-damage pattern: silent short-
// circuit before applyWithReplacements runs.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). Wave 97 closes the source-conditional
// CantGainLifeFromSource$ Card.X sub-filter — the changeLife call site
// threads an optional `sourceCardId` and the gate consults its
// `sourceMatches` predicate AFTER the seat predicate. When the static
// omits FromSource$ the predicate accepts every source (existing
// always-active behavior preserved).
import type {
  EntityId,
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantGainLifePayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * Wave 97 — true iff the cause source `sourceId` matches the static's
   * CantGainLifeFromSource$ filter. When the static omits the
   * sub-filter, the predicate trivially matches every source (the
   * unconditional canonical case). When `sourceId` is undefined at the
   * call site (no causal source threaded through changeLife), the
   * predicate accepts only the unconditional shape — so a
   * source-scoped gate doesn't fire on sourceless gains (Soul's Attendant
   * spontaneous trigger paths that don't carry a source id).
   */
  readonly sourceMatches: (sourceId: EntityId | undefined, game: Game) => boolean;
}

export class CantGainLifeStaticHandler extends StaticHandler {
  static override readonly mode = "CantGainLife" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    // Wave 97 — optional FromSource$ sub-filter. When present, only
    // life-gain whose causal source-card matches the predicate is
    // blocked; sourceless gains are conservatively NOT blocked (the
    // gate falls through). When absent, the predicate trivially accepts
    // any (or no) source — the historical unconditional behavior.
    const fromSourceRaw = literalRaw(params.CantGainLifeFromSource);
    const hasSourceFilter = fromSourceRaw !== undefined;
    const sourcePred = hasSourceFilter
      ? buildCardIdPredicate(fromSourceRaw, ctx.sourceCardId, ctx.controllerSeat)
      : undefined;

    const payload: CantGainLifePayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      playerMatches: (seat) => seatPred(seat),
      sourceMatches: (sourceId, game) => {
        if (!hasSourceFilter) return true;
        if (sourceId === undefined) return false;
        return sourcePred ? sourcePred(sourceId, game) : false;
      },
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
      mode: "CantGainLife",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantGainLifeStaticHandler);

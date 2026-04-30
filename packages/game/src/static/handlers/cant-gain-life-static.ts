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
// buildPlayerPredicate grammar). Source-conditional sub-filters
// (CantGainLifeFromSource$ Card.X) are TODO(advanced).
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

export interface CantGainLifePayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantGainLifeStaticHandler extends StaticHandler {
  static override readonly mode = "CantGainLife" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantGainLifePayload = {
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
      mode: "CantGainLife",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantGainLifeStaticHandler);

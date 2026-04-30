// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 74 — CantDiscard static handler. CR 701.8 — discard prevention.
//
// Forge cards using this shape:
//   - Tamiyo, Collector of Tales (Spells and abilities your opponents
//                                  control can't cause you to discard
//                                  cards or sacrifice permanents.)
//
// DSL (corpus):
//   S:Mode$ CantDiscard | ValidPlayer$ You | ValidCause$ SpellAbility.OppCtrl | ForCost$ False | Description$ ...
//
// What it does (Forge): consulted at the discard call site
// (GameAction.moveTo with cause "discard" or cost-discard.payCost).
// When ValidPlayer$ matches the player whose hand the card came from,
// the discard is rejected silently — no zone change, no CardDiscarded
// event, no DiscardedTrigger fire.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. Matches the
// rest of the Cant* family in MODE_TO_CATEGORY. The replacements list
// is empty; the gate is enforced at the discard call site.
//
// MVP scope:
//   - ValidPlayer$ <filter> via buildPlayerPredicate (You / Opponent /
//     Any / Player).
//   - "no discard period for matched player" is the durable contract.
// TODO(advanced):
//   - ValidCause$ SpellAbility.OppCtrl  — only block discards CAUSED
//                                          by opponent-controlled spells/
//                                          abilities. Tamiyo's full
//                                          fidelity needs the cause-
//                                          source-controller threading.
//   - ForCost$ True/False               — distinguishes cost-driven
//                                          discard (e.g. Madness, Bargain)
//                                          from effect-driven discard.
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

export interface CantDiscardPayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantDiscardStaticHandler extends StaticHandler {
  static override readonly mode = "CantDiscard" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantDiscardPayload = {
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
      mode: "CantDiscard",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantDiscardStaticHandler);

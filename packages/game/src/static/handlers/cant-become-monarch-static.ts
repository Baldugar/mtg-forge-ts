// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — CantBecomeMonarch static handler. CR 716 — Conspiracy:
// Take the Crown / Monarch tracker.
//
// Forge cards using this shape (~1 card in corpus):
//   - Jared Carthalion ("You can't become the monarch this turn.")
//
// DSL (corpus):
//   SVar:STCantMonarch:Mode$ CantBecomeMonarch | ValidPlayer$ You
//                                              | Description$ ...
//
// What it does (Forge): consulted at the grantMonarch call site
// (monarch-tracker.ts). When ValidPlayer$ matches the seat that
// would become the monarch, the grant is rejected silently — no
// BecameMonarch event fires, the prior monarch (if any) is
// preserved unchanged. Mirrors Wave 70.O's CantPhaseIn shape but
// on the monarch-grant side.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the
// grantMonarch call site rather than via a derived replacement
// chain. Mirrors Wave 70.O's CantPhaseIn / CantPhaseOut /
// CantChangeLife pattern.
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

export interface CantBecomeMonarchPayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantBecomeMonarchStaticHandler extends StaticHandler {
  static override readonly mode = "CantBecomeMonarch" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantBecomeMonarchPayload = {
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
      mode: "CantBecomeMonarch",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantBecomeMonarchStaticHandler);

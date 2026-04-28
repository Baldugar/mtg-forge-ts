// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.H — CantSearchLibrary static handler. CR 701.18 — "X can't
// search a library". Forge cards using this:
//   - Mindlock Orb     (Players can't search libraries)
//   - Stranglehold     (Your opponents can't search libraries)
//
// Forge expresses these via Continuous + AddKeyword$ CantSearchLibrary on
// the Affected$ player; in our DSL we accept the direct
// `S:Mode$ CantSearchLibrary | ValidPlayer$ <filter>` shape too. Both
// shapes route through this handler when wired (the Continuous form
// fires its keyword grant and the keyword consumer reads the same gate
// helper).
//
// DSL:
//   S:Mode$ CantSearchLibrary | ValidPlayer$ Player    | Description$ ...
//   S:Mode$ CantSearchLibrary | ValidPlayer$ Opponent  | Description$ ...
//
// What it does (Forge): the matched player can't search any library.
// The library-search call sites (SeekEffect, TransmuteEffect, etc.)
// consult `canSearchLibrary(game, seat)` before scanning the library;
// on a match the search is short-circuited and no card is found / moved.
//
// Routing: cantMustMay category — pure action filter consulted by the
// search-library call sites. The describe() payload exposes
// `playerMatches(seat)`; the gate consumer (canSearchLibrary in
// wave60-cant-gates.ts) walks the registry per-query.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). The Aven Mindcensor "search top 4
// instead" partial-replacement variant is a different mechanic
// (replacement-handler scope), TODO(advanced).
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantSearchLibraryPayload {
  readonly kind: "cantSearchLibrary";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantSearchLibraryStaticHandler extends StaticHandler {
  static override readonly mode = "CantSearchLibrary" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantSearchLibraryPayload = {
      kind: "cantSearchLibrary",
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
      category: "cantMustMay",
      mode: "CantSearchLibrary",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantSearchLibraryStaticHandler);

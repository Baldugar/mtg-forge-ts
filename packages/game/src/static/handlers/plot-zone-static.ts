// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 76 — PlotZone static handler. CR — Plot mechanic (MKM:
// Murders at Karlov Manor block). Forge's
// StaticAbilityPlotZone.java equivalent.
//
// Plot is a keyword action that exiles a card with a "plotted"
// status, marking it for a delayed cast on a future turn (CR 717
// / 702.165). The PlotZone static modifies which zone(s) a player
// may plot from — by default plot is restricted to the hand, and
// PlotZone overrides this to allow plotting from a custom zone
// (e.g. graveyard, library — for cards like "you may plot cards
// from your graveyard").
//
// Forge cards using this shape (~1 card in corpus): bespoke "you
// may plot cards from <zone>" effects.
//
// DSL (corpus):
//   S:Mode$ PlotZone | ValidPlayer$ You | Zone$ Graveyard
//          | Description$ ...
//
// What it does (Forge): consulted at the plot-action legality
// gate. The default plot zone (Hand) is augmented with the
// matched static's Zone$ value when ValidPlayer$ matches the
// active player.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (overrides the
// canonical CR plot-zone restriction).
//
// MVP scope: forward-compat stub. Our codebase has no Plot
// mechanic infra yet — there is no AB$ Plot handler, no per-card
// `plotted` flag, no plotted-zone management on cleanup. The
// static still registers (so ports of cards with this S: line
// don't break the parser) and the `plotZonesFor(player)` helper
// is exposed so the future Plot pipeline can read it uniformly.
// Out-of-scope (Wave 118 closure note) — wiring into the Plot legality
// gate is gated on the Plot mechanic landing as a first-class feature
// (currently no AB$ Plot handler, no per-card `plotted` flag, no
// plotted-zone management on cleanup). When the Plot pipeline lands
// it reads `plotZonesFor(player)` uniformly via the static handler;
// the static itself is registered today so corpus parsing succeeds.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface PlotZonePayload {
  readonly kind: "plotZone";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** The zone the matched player may plot from; falls back to Hand. */
  readonly zone: ZoneType;
}

const ZONE_BY_NAME: ReadonlyMap<string, ZoneType> = new Map(
  Object.values(ZoneType).map((z) => [z.toLowerCase(), z]),
);

export class PlotZoneStaticHandler extends StaticHandler {
  static override readonly mode = "PlotZone" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const zoneRaw = literalRaw(params.Zone);
    const zoneLookup =
      zoneRaw !== undefined && zoneRaw.length > 0 ? ZONE_BY_NAME.get(zoneRaw.toLowerCase()) : undefined;
    const zone: ZoneType = zoneLookup ?? ZoneType.Hand;

    const payload: PlotZonePayload = {
      kind: "plotZone",
      playerMatches: (seat) => seatPred(seat),
      zone,
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
      mode: "PlotZone",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(PlotZoneStaticHandler);

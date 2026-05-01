// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 76 — CantVenture static handler. CR — Venture into the
// Dungeon mechanic (AFR / Baldur's Gate sets). Forge's
// StaticAbilityCantVenture.java equivalent.
//
// Forge cards using this shape (~1 card in corpus): cards that
// gate matched players from venturing into the dungeon (no new
// dungeon entry, no advance through an in-progress dungeon).
//
// DSL (corpus):
//   S:Mode$ CantVenture | ValidPlayer$ <filter> | Description$ ...
//
// What it does (Forge): consulted at the venture-into-the-dungeon
// resolution call site. When ValidPlayer$ matches the player
// being asked to venture, the venture is rejected silently — no
// dungeon advance, no DungeonRoomEntered event emitted. Mirrors
// Wave 60.G's SkipUntap / Wave 70.O's CantPhaseIn pattern.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the future
// venture call site rather than via a derived replacement chain.
//
// Wave 103 — `canVenture` is now consulted by
// `dnd/initiative-tracker.ts:advanceUndercityRoom` (the AFR
// Initiative dungeon, the only Venture-mechanic surface ported
// today). When ValidPlayer$ matches the venturing seat,
// `advanceUndercityRoom` short-circuits silently — no dungeon
// advance, no UndercityRoomEntered event. Cards using the full
// "Venture into the Dungeon" mechanic (multi-dungeon choice from
// AFR / Baldur's Gate) remain on the SP4 milestone; the gate's
// shape and read-side contract are durable today.
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

export interface CantVenturePayload extends ReplacementGenPayload {
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantVentureStaticHandler extends StaticHandler {
  static override readonly mode = "CantVenture" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantVenturePayload = {
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
      mode: "CantVenture",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantVentureStaticHandler);

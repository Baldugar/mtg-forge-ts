// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — PhaseReversed static handler. CR 500 — turn structure.
//
// Forge cards using this shape (~1 card in corpus):
//   - Topsy Turvy ("The phases of each player's turn are reversed.")
//
// DSL (corpus):
//   S:Mode$ PhaseReversed | ValidPlayer$ Player | Description$ ...
//
// What it does (Forge): consulted at the phase-advance site. When
// matched, the phase order reverses — instead of beginning → main →
// combat → main → ending, the order becomes ending → main → combat
// → main → beginning.
//
// Routing: ruleChanging per MODE_TO_CATEGORY. Pure rule override
// consulted by the phase-advance path.
//
// Wave 106 — closes the prior consumer-side TODO(advanced). The
// PhaseHandler.runTurn step iterator now consults
// `isPhaseOrderReversed(game, seat)` (statics/wave70p-gate-helpers.ts)
// at turn start; on match it walks the phase sequence in REVERSE order
// for that turn. The handler is opt-in — turns where no PhaseReversed
// static covers the active seat observe the canonical CR 500
// beginning → main → combat → main → ending sequence.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface PhaseReversedPayload {
  readonly kind: "phaseReversed";
  /**
   * True iff `seat`'s phases are reversed by this gate. Topsy Turvy
   * uses ValidPlayer$ Player (every seat); future cards may scope it.
   */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class PhaseReversedStaticHandler extends StaticHandler {
  static override readonly mode = "PhaseReversed" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: PhaseReversedPayload = {
      kind: "phaseReversed",
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
      mode: "PhaseReversed",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(PhaseReversedStaticHandler);

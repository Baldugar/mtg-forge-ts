// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.D — AdditionalCombatPhase static handler. Grants the active
// player an additional combat phase + main phase after the current
// combat (CR 506). Examples:
//
//   S:Mode$ AdditionalCombatPhase | ValidPlayer$ You | Description$ ...
//     (Aurelia, the Warleader's emblem-shape; some emblems)
//
// What it does (Forge): on activation, stamps a per-seat counter on
// game.flags.pendingAdditionalCombatPhases keyed by every seat the
// `ValidPlayer$` filter matches. The phase handler's end-of-combat
// path consumes one pending entry per matching seat and injects the
// extra combat block via PhaseSequence.injectExtraCombat.
//
// Routing: ruleChanging category — overrides the canonical phase
// sequence. The describe() payload is informational; the durable
// contract is the per-seat counter mutation on activate.
//
// MVP scope: ValidPlayer$ You is the typical Forge shape. The active
// player at activate time is the one whose combat is about to bonus.
// Forge stamps the counter on activate and decrements at end-of-combat.
//
// NB: most cards using AdditionalCombat semantics are activated/sorcery
// abilities (Aggravated Assault / Relentless Assault / Hellkite Charger /
// Combat Celebrant / Savage Beating / Seize the Day) — those use the
// `AB$ AdditionalCombat` *effect* form, not this static. The static
// form is rarer (Aurelia emblem). Both mutate the same counter.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface AdditionalCombatPhasePayload {
  readonly kind: "additionalCombatPhase";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

const stampForMatchingSeats = (game: Game, pred: (seat: PlayerSeat) => boolean): void => {
  for (const p of game.players) {
    if (!pred(p.seat)) continue;
    const cur = game.flags.pendingAdditionalCombatPhases.get(p.seat) ?? 0;
    game.flags.pendingAdditionalCombatPhases.set(p.seat, cur + 1);
  }
};

export class AdditionalCombatPhaseStaticHandler extends StaticHandler {
  static override readonly mode = "AdditionalCombatPhase" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    // Stamp the counter at build-time (mirrors max-level-static.ts'
    // direct-stamp pattern). The static is a "while active, the player
    // gets one extra combat" — we model it by stamping one extra at
    // activation and letting the phase handler consume it. Re-activations
    // (zone-flicker on the source) re-stamp; that matches Forge's
    // re-trigger behavior.
    stampForMatchingSeats(ctx.game, seatPred);

    const payload: AdditionalCombatPhasePayload = {
      kind: "additionalCombatPhase",
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
      mode: "AdditionalCombatPhase",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AdditionalCombatPhaseStaticHandler);

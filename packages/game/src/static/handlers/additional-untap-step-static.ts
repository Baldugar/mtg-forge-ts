// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.G — AdditionalUntapStep static handler. Inserts an additional
// untap step at the start of the matched player's turn (CR 502; Awakening
// Zone / Time Vault analogues). Examples:
//
//   S:Mode$ AdditionalUntapStep | ValidPlayer$ You | Description$ ...
//     (Awakening Zone-shape / static-emblem variants)
//
// What it does (Forge): on activation, stamps a per-seat counter on
// `game.flags.pendingAdditionalUntapSteps`. The phase handler's untap-step
// turn-based action runs the canonical untap-all loop, then while the
// counter is positive, decrements and runs the loop again. Each consumed
// extra performs the full untap-step semantics (untap permanents +
// phasing + DontUntap gate consultation).
//
// Wave 99 — CR 502.2 ordering closed. Additional untap steps run
// BEFORE the canonical untap step in `phase-handler.ts`'s untap
// branch: the per-seat counter is drained via a `while
// (consumePendingAdditionalUntap(...)) { runUntapPass(...) }` loop
// PRECEDING the canonical pass. Two observable consequences:
//   - "at the beginning of the untap step" triggers see the extra
//     loop's events first.
//   - permanents tapped during the extra loop's resolution are
//     still untapped by the canonical loop that follows.
//
// Routing: ruleChanging category. Mirrors AdditionalCombatPhase's stamp-
// at-build-time pattern: the handler stamps the counter on activate +
// re-activations (zone-flicker on the source) re-stamp.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface AdditionalUntapStepPayload {
  readonly kind: "additionalUntapStep";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

const stampForMatchingSeats = (game: Game, pred: (seat: PlayerSeat) => boolean): void => {
  for (const p of game.players) {
    if (!pred(p.seat)) continue;
    const cur = game.flags.pendingAdditionalUntapSteps.get(p.seat) ?? 0;
    game.flags.pendingAdditionalUntapSteps.set(p.seat, cur + 1);
  }
};

export class AdditionalUntapStepStaticHandler extends StaticHandler {
  static override readonly mode = "AdditionalUntapStep" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    // Stamp the counter at build-time (mirrors AdditionalCombatPhase's
    // direct-stamp pattern). Re-activations re-stamp; the counter resets
    // at TurnEnded so leftovers do not roll over.
    stampForMatchingSeats(ctx.game, seatPred);

    const payload: AdditionalUntapStepPayload = {
      kind: "additionalUntapStep",
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
      mode: "AdditionalUntapStep",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(AdditionalUntapStepStaticHandler);

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.G — SkipUntap static handler. The matched player skips their
// untap step entirely (CR 502.1). Distinct from Wave 60's `DontUntap`
// (which keeps the step but blocks specific permanents from untapping).
// Examples:
//
//   S:Mode$ SkipUntap | ValidPlayer$ You | Description$ ...
//     (Stasis — the iconic "skip your untap step")
//   S:Mode$ SkipUntap | ValidPlayer$ Opponent | Description$ ...
//     (Curse / Vow shapes targeting an opponent)
//
// What it does (Forge): the phase handler's untap-step entry consults
// `shouldSkipUntap(game, activeSeat)` before performing any untap actions.
// On match, the step's turn-based actions become a no-op. The step itself
// still emits StepStarted / StepEnded (Forge: skipped step is still a step;
// triggers that fire "at the beginning of the untap step" do NOT fire when
// the step is skipped per CR 502.1, but priority + phase emission is
// preserved for replay determinism).
//
// Routing: ruleChanging category. The describe() payload exposes
// `playerMatches(seat)`; the gate consumer (shouldSkipUntap in
// wave60-turn-structure-gates.ts) walks the registry per-query.
//
// Scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). Wave 101 closes the prior TODO(advanced)
// for `IsPresent$` / `PresentCompare$` / `PresentZone$` sub-conditional
// gates via the shared `buildIsPresentGate` helper — the canonical Forge
// shape `S:Mode$ SkipUntap | ValidPlayer$ You | IsPresent$ Land.YouCtrl
// | PresentCompare$ GE5` ("if you control five or more lands, skip your
// untap step") is now honored uniformly.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildIsPresentGate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface SkipUntapPayload {
  readonly kind: "skipUntap";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * True iff the static's `IsPresent$` sub-conditional gate is currently
   * satisfied. Defaults to always-true when no IsPresent$ is set. The gate
   * consumer (shouldSkipUntap) calls this with the live Game to honor
   * mid-turn board-state changes (Wave 101).
   */
  readonly isPresentSatisfied: (game: Game) => boolean;
}

export class SkipUntapStaticHandler extends StaticHandler {
  static override readonly mode = "SkipUntap" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const presentGate = buildIsPresentGate(params, {
      sourceCardId: ctx.sourceCardId,
      controllerSeat: ctx.controllerSeat,
    });

    const payload: SkipUntapPayload = {
      kind: "skipUntap",
      playerMatches: (seat) => seatPred(seat),
      isPresentSatisfied: (game) => presentGate(game),
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
      mode: "SkipUntap",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(SkipUntapStaticHandler);

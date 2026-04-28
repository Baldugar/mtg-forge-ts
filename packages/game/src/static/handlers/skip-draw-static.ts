// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.G — SkipDraw static handler. The matched player skips their
// draw step entirely (CR 504.1). Examples:
//
//   S:Mode$ SkipDraw | ValidPlayer$ You | Description$ ...
//     (The Abyss-style enchantments / certain Curses)
//   S:Mode$ SkipDraw | ValidPlayer$ Opponent | Description$ ...
//     (Underworld Dreams analogues — opponent skips draw)
//
// What it does (Forge): the phase handler's draw-step turn-based action
// consults `shouldSkipDraw(game, activeSeat)` before performing the draw.
// On match, no card is drawn; the rest of the draw step (priority window)
// proceeds normally — Forge keeps the step shell, just skips the action.
//
// NB: this is the static-form skip; most "skip your next draw step" effects
// in Forge are actually delayed-trigger / one-shot replacements rather than
// continuous statics. The static form covers the "you don't draw cards"
// permanent shapes (Wheel of Sun and Moon's redirection has a separate
// path, but the suppression edge is observable via this static when the
// matching card uses S:Mode$ SkipDraw rather than R:Event$ Draw).
//
// Routing: ruleChanging category. The describe() payload exposes
// `playerMatches(seat)`; the gate consumer (shouldSkipDraw in
// wave60-turn-structure-gates.ts) walks the registry per-query.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). Sub-conditional gates are TODO(advanced).
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface SkipDrawPayload {
  readonly kind: "skipDraw";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class SkipDrawStaticHandler extends StaticHandler {
  static override readonly mode = "SkipDraw" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: SkipDrawPayload = {
      kind: "skipDraw",
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
      mode: "SkipDraw",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(SkipDrawStaticHandler);

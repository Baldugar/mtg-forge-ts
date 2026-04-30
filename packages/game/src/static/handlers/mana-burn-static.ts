// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 73 — ManaBurn static handler. Forge's
// `forge.game.staticability.StaticAbilityUnspentMana#hasManaBurn`.
//
// Forge cards using this shape (1 card in corpus): Yurlok of Scorch
// Thrash. The card grants every player the pre-2009 "mana burn" rule
// (CR pre-Magic-2010 R 119.10): when a player loses unspent mana, they
// lose that much life.
//
// DSL:
//   S:Mode$ ManaBurn | Description$ ...
//   S:Mode$ ManaBurn | ValidPlayer$ <filter> | Description$ ...
//
// What it does (Forge): consulted by ManaPool.hasBurn() at the end of
// each phase. When `getRules().hasManaBurn()` is false (modern rules),
// the static gates the same code path: any matching ValidPlayer$ static
// makes the player lose 1 life per unspent mana that just emptied.
//
// Routing: ruleChanging — already mapped in MODE_TO_CATEGORY. The
// payload exposes the seat predicate. Read by `playerHasManaBurn` in
// statics/wave73-unspent-mana.ts.
//
// MVP scope:
//   - No ValidPlayer$ token → match every seat (Yurlok shape: each
//     player burns).
//   - ValidPlayer$ You / Opponent / Any / Player via Wave 50 grammar.
//
// Note on game-rules variant: GameRules.manaBurn is a separate
// per-game config flag (set true in retro / pre-M10 formats). When
// that flag is true, every player burns regardless of any active
// ManaBurn static; the static is the additive (per-player) form.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface ManaBurnPayload {
  readonly kind: "manaBurn";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class ManaBurnStaticHandler extends StaticHandler {
  static override readonly mode = "ManaBurn" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: ManaBurnPayload = {
      kind: "manaBurn",
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
      mode: "ManaBurn",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(ManaBurnStaticHandler);

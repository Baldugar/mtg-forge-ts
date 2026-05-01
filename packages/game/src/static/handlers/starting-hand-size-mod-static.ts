// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.I — StartingHandSizeMod static handler. CR 103 — modifies the
// starting hand size by the given amount for the matched player.
// Examples (commander/emblem-flavored):
//
//   S:Mode$ StartingHandSizeMod | ValidPlayer$ You | Amount$ +1
//     | Description$ ...
//   S:Mode$ StartingHandSizeMod | ValidPlayer$ You | Amount$ -7
//     | Description$ Yawgmoth's Bargain-style emblem.
//
// What it does (Forge): the game-start drawing logic consults the sum
// of all active StartingHandSizeMod statics for the player and adjusts
// the opening hand size. After the opening hand is drawn (mid-game),
// the static is a no-op for that game.
//
// Implementation strategy:
//   The handler stamps `player.startingHandSizeMod += amount` on
//   activate and reverts on deactivate. The game-start logic
//   (`drawStartingHand` / `mulligan` / similar) consults the field
//   when computing the effective opening hand size.
//
//   Wave 105 closure of the prior TODO(advanced) for game-start
//   integration: `effectiveStartingHandSize(player, base)` (player.ts)
//   layers the per-player accumulator onto the rules-default starting
//   hand size with a floor at 0. Game-start drawing logic should call
//   that helper rather than reading `rules.startingHandSize` directly,
//   so emblems / commanders / mulligan-modifiers compose correctly.
//
// Routing: ruleChanging category. The static stamps a per-player slot
// that the game-start drawing logic reads. The describe() payload
// exposes the amount + ValidPlayer predicate so the consumer can also
// walk the registry directly.
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface StartingHandSizeModPayload {
  readonly kind: "startingHandSizeMod";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** Modifier value (positive or negative) applied to the starting hand size. */
  readonly amount: number;
}

const parseAmount = (raw: string | undefined): number => {
  if (raw === undefined || raw.length === 0) return 0;
  // Forge accepts both `+N` / `-N` modifier shapes and bare integers.
  // Number.parseInt handles all three (leading + is allowed).
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

const stampForMatchingSeats = (game: Game, pred: (seat: PlayerSeat) => boolean, amount: number): void => {
  for (const p of game.players) {
    if (!pred(p.seat)) continue;
    p.startingHandSizeMod = (p.startingHandSizeMod ?? 0) + amount;
  }
};

export class StartingHandSizeModStaticHandler extends StaticHandler {
  static override readonly mode = "StartingHandSizeMod" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const amount = parseAmount(literalRaw(params.Amount));

    // Stamp the per-player accumulator at build-time. The accumulator
    // shape (additive on the field) lets multiple static instances
    // stack — Forge's behavior when a player has multiple starting-
    // hand-size emblems (e.g. mulligan-modifying commanders +
    // additional emblems).
    stampForMatchingSeats(ctx.game, seatPred, amount);

    const payload: StartingHandSizeModPayload = {
      kind: "startingHandSizeMod",
      playerMatches: (seat) => seatPred(seat),
      amount,
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
      mode: "StartingHandSizeMod",
      describe: () => payload,
    };
  }
}

// Exported for the future deactivate hook in StaticEffectRegistry. The
// per-handler deactivate path doesn't fire today — so the slot lifetime
// mirrors the static's lifetime via re-stamping on re-activate. When
// the deactivate hook ships, this helper subtracts the amount back out.
export const _revertStartingHandSizeMod = (
  game: Game,
  pred: (seat: PlayerSeat) => boolean,
  amount: number,
): void => {
  for (const p of game.players) {
    if (!pred(p.seat)) continue;
    p.startingHandSizeMod = (p.startingHandSizeMod ?? 0) - amount;
  }
};

staticHandlerRegistry.register(StartingHandSizeModStaticHandler);

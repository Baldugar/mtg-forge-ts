// SPDX-License-Identifier: GPL-3.0-or-later
// Monarch tracker (CR 716) — Conspiracy: Take the Crown.
//
// game.flags.monarch: PlayerSeat | null. The monarch:
//   - Draws a card at the beginning of their end step (CR 716.4a).
//   - Combat damage to the monarch transfers monarchy to the attacker's
//     controller (CR 716.4b). Per CR 506.4 the transfer happens AFTER
//     damage is dealt but before triggers resolve.
//
// This module is a small set of pure helpers; phase-handler.ts (end-step
// draw) and combat-handler.ts (post-damage transfer) call them at the
// right turn-based / damage step boundaries.
import type { GameEvent, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Set the monarch + emit BecameMonarch (and LostMonarch for the prior
 * holder if any). Returns the events to yield (caller routes through the
 * engine pipeline). Idempotent on no-op self-grants.
 */
export const grantMonarch = (game: Game, seat: PlayerSeat): readonly GameEvent[] => {
  const prior = game.flags.monarch;
  if (prior === seat) return [];
  game.flags.monarch = seat;
  const events: GameEvent[] = [];
  if (prior !== null) {
    events.push({
      kind: "LostMonarch",
      version: 1,
      turn: game.turn,
      phase: game.phase,
      payload: { playerSeat: prior },
    });
  }
  events.push({
    kind: "BecameMonarch",
    version: 1,
    turn: game.turn,
    phase: game.phase,
    payload: { playerSeat: seat },
  });
  return events;
};

/**
 * Combat-damage transfer hook. Called from CombatHandler after each
 * combat-damage emission whose target was a player. If the target is the
 * current monarch and the source's controller is a different seat,
 * transfer monarchy.
 */
export const onCombatDamageToPlayer = (
  game: Game,
  sourceCardId: number,
  targetSeat: PlayerSeat,
  amount: number,
): readonly GameEvent[] => {
  if (amount <= 0) return [];
  const holder = game.flags.monarch;
  if (holder === null || holder !== targetSeat) return [];
  const sourceCard = game.cards.get(sourceCardId as Parameters<Game["cards"]["get"]>[0]);
  if (!sourceCard) return [];
  const attackerSeat = sourceCard.controllerSeat;
  if (attackerSeat === targetSeat) return [];
  return grantMonarch(game, attackerSeat);
};

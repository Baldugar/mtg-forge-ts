// SPDX-License-Identifier: GPL-3.0-or-later
// Initiative tracker (CR 906) — Adventures in the Forgotten Realms.
//
// game.flags.initiative: PlayerSeat | null. The initiative starts unowned
// and is taken by the FIRST card that says "you take the initiative". Two
// transitions matter for this wave:
//
//   1. Combat damage to the initiative-holder transfers initiative to the
//      attacker's controller (CR 906.4b). Hooked from CombatHandler.
//   2. At the beginning of the initiative-holder's upkeep, they advance
//      one room in the Initiative dungeon (Undercity; CR 906.4c). MVP:
//      emit a stub "InitiativeAdvanced" intent — the actual dungeon-room
//      advance requires the dungeon data structure (deferred to a later
//      wave). The hook is wired here so the data-structure work is the
//      only remaining piece.
//
// This module is a small set of pure helpers; phase-handler.ts and
// combat-handler.ts call them at the right turn-based-action / damage
// step boundaries.
import type { GameEvent, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Wave 45 — Undercity dungeon room sequence (CR 906.4c). The 10 rooms in
 * Forge's `initiative.txt` are listed in venture order. Per-room SVar
 * effects are TODO(advanced); the index is the only piece of state the
 * MVP tracks. Index 0 is "not yet entered"; the first venture lands on
 * room 1 (SecretEntrance) and the 10th venture wraps to 1 (per CR 309.4
 * — completing a dungeon lets the next venture start from the entrance).
 */
export const UNDERCITY_ROOMS: readonly string[] = [
  "SecretEntrance",
  "Forge of Doom",
  "Shrine of the Gnoll Lord",
  "Lost Well",
  "Stash of Goods",
  "Chamber of Sleep",
  "Sandfall Cell",
  "Down Among the Dead Men",
  "Hall of Mists",
  "Lair of the Spider",
];

/**
 * Advance the Undercity dungeon by one room (mod 10). Returns the new
 * room index (1..10) and the corresponding name. Caller routes the
 * UndercityRoomEntered event through the engine pipeline.
 */
export const advanceUndercityRoom = (game: Game, seat: PlayerSeat): readonly GameEvent[] => {
  const prior = game.flags.undercityRoom;
  const next = (prior % UNDERCITY_ROOMS.length) + 1;
  game.flags.undercityRoom = next;
  const roomName = UNDERCITY_ROOMS[next - 1] ?? "SecretEntrance";
  return [
    {
      kind: "UndercityRoomEntered",
      version: 1,
      turn: game.turn,
      phase: game.phase,
      payload: { playerSeat: seat, room: next, roomName },
    },
  ];
};

/**
 * Set the initiative-holder + emit BecameInitiative for the new holder.
 * Returns the events to yield (caller routes through engine pipeline).
 *
 * Pitfall: writes through `flags.initiative` (the snapshot-backed slot);
 * the older duck-typed `Game.initiativeSeat` field used by Wave 22's
 * `TakeInitiativeEffect` is migrated alongside this tracker.
 */
export const grantInitiative = (game: Game, seat: PlayerSeat): readonly GameEvent[] => {
  const prior = game.flags.initiative;
  if (prior === seat) return [];
  game.flags.initiative = seat;
  // Wave 45 — taking the initiative ventures into the Undercity (CR 906.4c
  // covers the upkeep advance; CR 906.4 says the player who takes the
  // initiative also ventures immediately on TAKE). Emit BecameInitiative
  // first, then the dungeon advance.
  const becameEvent: GameEvent = {
    kind: "BecameInitiative",
    version: 1,
    turn: game.turn,
    phase: game.phase,
    payload: { playerSeat: seat },
  };
  return [becameEvent, ...advanceUndercityRoom(game, seat)];
};

/**
 * Combat-damage transfer hook. Called from CombatHandler AFTER each
 * `game.action.damage(..., isCombat=true)` whose target is a player. If
 * the target is the current initiative-holder AND the source's controller
 * is a different seat, transfer initiative. Per CR 506.4 the transfer
 * happens AFTER damage is dealt but before the resulting triggers
 * resolve — combat-handler invokes us synchronously between the damage
 * yield and the next damage emission, which matches.
 */
export const onCombatDamageToPlayer = (
  game: Game,
  sourceCardId: number,
  targetSeat: PlayerSeat,
  amount: number,
): readonly GameEvent[] => {
  if (amount <= 0) return [];
  const holder = game.flags.initiative;
  if (holder === null || holder !== targetSeat) return [];
  const sourceCard = game.cards.get(sourceCardId as Parameters<Game["cards"]["get"]>[0]);
  if (!sourceCard) return [];
  const attackerSeat = sourceCard.controllerSeat;
  if (attackerSeat === targetSeat) return [];
  return grantInitiative(game, attackerSeat);
};

/**
 * Upkeep dungeon-advance hook. Called from PhaseHandler at the start of
 * the active player's upkeep when they're the initiative-holder. MVP
 * stub: returns a sentinel intent so observers (and future tests) see
 * the hook fire. Full Initiative-dungeon (Undercity) advance lands once
 * the Dungeon data structure exists.
 */
export const onUpkeepAdvanceInitiativeDungeon = (
  game: Game,
  activeSeat: PlayerSeat,
): readonly GameEvent[] => {
  if (game.flags.initiative !== activeSeat) return [];
  // Wave 45 — venture one room. Per-room SVar effects (room exit triggers,
  // Lair of the Spider's "venture again", etc.) are TODO(advanced); the
  // index advance + UndercityRoomEntered emit is the canonical pulse that
  // observers and tests need today.
  return advanceUndercityRoom(game, activeSeat);
};

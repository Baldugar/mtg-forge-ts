// SPDX-License-Identifier: GPL-3.0-or-later
// Live in-game Player entity. Composes a LobbyPlayer (pre-game identity) with
// mutable game state (life, counters, mana pool, zones). The zones map is
// populated at MatchSetup time (Task 45); manaPool is typed once Task 36 adds
// the ManaPool class.
import type { CounterType, LobbyPlayer, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import type { Zone } from "./zone/zone.js";

export class Player {
  // WHY: life is initialized from GameRules.startingLife by the Game ctor
  // (defaults to 20 when Player is constructed standalone, for backwards
  // compatibility with tests that mint a Player without going through Game).
  life: number;
  counters = new Map<CounterType, number>();
  // Typed by Task 36 (ManaPool). Holding unknown here keeps the field slot
  // stable so downstream code can reference `player.manaPool` before the
  // concrete class exists.
  manaPool: unknown = null;
  // Populated by MatchSetup (Task 45); key by ZoneType lets consumers look up
  // a player's library/hand/graveyard/battlefield uniformly.
  zones = new Map<ZoneType, Zone>();

  constructor(
    readonly seat: PlayerSeat,
    readonly lobbyPlayer: LobbyPlayer,
    public teamId: number,
    startingLife = 20,
  ) {
    this.life = startingLife;
  }

  toJSON(): {
    seat: PlayerSeat;
    lobbyPlayerId: string;
    teamId: number;
    life: number;
    counters: Record<string, number>;
  } {
    return {
      seat: this.seat,
      lobbyPlayerId: this.lobbyPlayer.id,
      teamId: this.teamId,
      life: this.life,
      counters: Object.fromEntries(this.counters),
    };
  }
}

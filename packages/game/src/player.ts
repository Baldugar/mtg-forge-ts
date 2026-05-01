// SPDX-License-Identifier: GPL-3.0-or-later
// Live in-game Player entity. Composes a LobbyPlayer (pre-game identity) with
// mutable game state (life, counters, mana pool, zones). The zones map is
// populated at MatchSetup time (Task 45); manaPool is typed once Task 36 adds
// the ManaPool class.
import type { CounterType, EntityId, LobbyPlayer, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Zone } from "./zone/zone.js";
import { OutsideTheGame } from "./zone/zones/outside-the-game.js";
import { Sideboard } from "./zone/zones/sideboard.js";

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
  // Wave 45 — Unfinity / Unstable contraption deck slot. Forge models the
  // contraption deck as a separate ordered Zone the player constructs at
  // game start (CR 717.x). MVP holds an opt-in slot here; cards-package
  // populates it (TODO(advanced) — wiring lives in SP4 once the lobby
  // surface ships a contraption-deck builder). When undefined, the
  // AssembleContraption effect emits the ContraptionAssembled pulse and
  // stamps an attractions counter on the source so observers still fire.
  contraptionDeck: Zone | undefined = undefined;
  // Wave 87 — Unfinity attraction deck slot. Forge models the attraction
  // deck as a separate ordered Zone, similar in spirit to the
  // `contraptionDeck` above; cards-package populates the contents at
  // game start. When non-empty, OpenAttractionEffect pops the top card
  // onto the battlefield (mirrors AssembleContraption's deck-pop branch);
  // otherwise the legacy attractions-counter bump path runs.
  attractionDeck: Zone | undefined = undefined;
  // SP2 Milestone G (Task 30): CR 704.5b — set when the player was required
  // to draw from an empty library since the last SBA check. The SBA engine
  // reads this flag to produce a `playerLosesEmptyDraw` action, then clears
  // it when the loss is recorded so the same empty-draw doesn't fire twice.
  // SP2's draw mutator will set this when library.size === 0 at draw time
  // (Milestone L plumbs in the full draw→empty→lose pipeline).
  failedDrawFromEmptyLibrary = false;
  // Damage prevention shield — set by PreventDamageEffect. Consumption
  // (intercepting incoming damage through the replacement-ability pipeline)
  // is deferred to SP3/F2. The field is typed as `number` (0 = no shield).
  damagePreventionShield = 0;
  // Wave 60.I — StartingHandSizeMod accumulator (CR 103). Stamped by
  // active `S:Mode$ StartingHandSizeMod | ValidPlayer$ <filter> |
  // Amount$ +/-N` statics on activate. The game-start drawing logic
  // (drawStartingHand / mulligan) reads this when computing the
  // effective opening hand size; mid-game changes are no-ops. Multiple
  // active statics stack additively. Default 0.
  startingHandSizeMod = 0;
  // Audit I-12 — per-seat loss flag, set by SbaEngine.markPlayerLost when
  // the player has lost. Distinct from Game.terminalState.concededSeats:
  // in 3+ player matches terminalState is only set when ≤1 player remains,
  // but per-seat liveness must still be tracked so loss-conditions skips
  // already-lost seats and the priority pipeline excludes them. CR 800.4.
  hasLost = false;

  constructor(
    readonly seat: PlayerSeat,
    readonly lobbyPlayer: LobbyPlayer,
    public teamId: number,
    startingLife = 20,
  ) {
    this.life = startingLife;
  }

  /**
   * Wave 66 — Sideboard convenience accessor. Returns the player's
   * Sideboard zone, lazy-creating it if absent. Engine internals that
   * already operate via `player.zones.get(ZoneType.Sideboard)` are not
   * required to use this; it exists for keyword handlers + tests that
   * want a stable reference. CR 100.4 / 100.5: a player's sideboard is
   * "outside the game" until cards from it are brought in.
   */
  get sideboard(): Zone {
    let z = this.zones.get(ZoneType.Sideboard);
    if (!z) {
      z = new Sideboard(ZoneType.Sideboard, this.seat);
      this.zones.set(ZoneType.Sideboard, z);
    }
    return z;
  }

  /**
   * Wave 66 — OutsideTheGame convenience accessor. Returns the player's
   * OutsideTheGame zone, lazy-creating it if absent. Wishes / Companion /
   * Double-team-conjure use this slot to materialize cards before moving
   * them into a "real" zone.
   */
  get outsideTheGame(): Zone {
    let z = this.zones.get(ZoneType.OutsideTheGame);
    if (!z) {
      z = new OutsideTheGame(ZoneType.OutsideTheGame, this.seat);
      this.zones.set(ZoneType.OutsideTheGame, z);
    }
    return z;
  }

  /**
   * Wave 66 — append a card id to the sideboard (creating the zone on
   * demand). Mirrors the pattern of `Library.add`/`Hand.add` for callers
   * that want a one-liner for test fixture / future setup wiring.
   */
  addToSideboard(cardId: EntityId): void {
    this.sideboard.add(cardId);
  }

  /**
   * Wave 66 — append a card id to the outside-the-game zone (creating
   * the zone on demand). Used by Companion declaration plumbing +
   * `GameAction.conjureCopyToHand` to mint a duplicate before promoting
   * it to hand.
   */
  addToOutsideTheGame(cardId: EntityId): void {
    this.outsideTheGame.add(cardId);
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

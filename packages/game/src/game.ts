// SPDX-License-Identifier: GPL-3.0-or-later
// Top-level Game object: composes lobby participants into Players, owns the
// shared zones (exile, ante, stack), per-Game mutable flags, and the
// entity-id allocator. Consumers construct with a SeededRng so every
// mutation is deterministic.
//
// SP4 will replace `attachCardDb` with the real CardDb integration.
import type { EntityId, LobbyPlayer, PhaseStep, PlayerSeat, Rng } from "@mtg-forge-ts/core";
import {
  GameStateIntegrityError,
  PhaseStep as Phase,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { Card } from "./card.js";
import type { GameFlags } from "./game-flags.js";
import { createDefaultFlags } from "./game-flags.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Player } from "./player.js";
import { Stack } from "./stack/stack.js";
import type { TerminalState } from "./terminal-state.js";
import { Ante } from "./zone/zones/ante.js";
import { Exile } from "./zone/zones/exile.js";

export class Game {
  readonly meta: GameMeta;
  readonly rules: GameRules;
  readonly rng: Rng;
  private entityIdCounter = 0;

  turn = 1;
  phase: PhaseStep = Phase.Untap;
  activePlayer: PlayerSeat = mkPlayerSeat(0);
  priorityPlayer: PlayerSeat | null = null;
  /**
   * Resolved at setup time by a die-roll off `rng`. Null until
   * `setupGame` runs the die-roll step. `firstPlayerSkipsDraw` reads this
   * (not seat 0) to determine whose first-turn Draw is elided.
   * Consumers who want deterministic seat-0 starts can assign this field
   * before invoking setupGame; the generator respects an existing value.
   */
  startingPlayer: PlayerSeat | null = null;

  readonly players: Player[];
  readonly sharedZones: { stack: Stack; exile: Exile; ante: Ante };
  readonly flags: GameFlags;
  // Registry of every live Card in the game, keyed by EntityId. GameAction
  // mutators (tap, addCounter, moveTo, …) look up cards here to update their
  // mutable state. Populated by MatchSetup (Task 45) and by token/emblem
  // factories in SP2; SP1 tests seed it directly.
  readonly cards = new Map<EntityId, Card>();
  terminalState: TerminalState | null = null;

  constructor(opts: { lobbyPlayers: LobbyPlayer[]; rules: GameRules; meta: GameMeta; rng: Rng }) {
    if (opts.lobbyPlayers.length < opts.rules.playerCount.min) {
      throw new GameStateIntegrityError(
        `Game requires at least ${opts.rules.playerCount.min} players, got ${opts.lobbyPlayers.length}`,
      );
    }
    if (opts.lobbyPlayers.length > opts.rules.playerCount.max) {
      throw new GameStateIntegrityError(
        `Game allows at most ${opts.rules.playerCount.max} players, got ${opts.lobbyPlayers.length}`,
      );
    }
    this.rules = opts.rules;
    this.meta = opts.meta;
    this.rng = opts.rng;
    this.players = opts.lobbyPlayers.map(
      (lp, i) =>
        new Player(mkPlayerSeat(i), lp, opts.rules.teamAssignments?.[i] ?? i, opts.rules.startingLife),
    );
    this.sharedZones = {
      stack: new Stack(),
      exile: new Exile(ZoneType.Exile, null),
      ante: new Ante(ZoneType.Ante, null),
    };
    this.flags = createDefaultFlags();
  }

  newEntityId(): EntityId {
    return mkEntityId(this.entityIdCounter++);
  }

  /**
   * Snapshot-restore only. GameSnapshot rehydrates the private entity-id
   * allocator so freshly-minted ids after restore don't collide with ids
   * already baked into the restored card registry. Consumers must not call
   * this outside the snapshot-restore path — it breaks the append-only
   * monotonicity guarantee newEntityId relies on for uniqueness.
   */
  restoreEntityIdCounter(n: number): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`restoreEntityIdCounter: expected non-negative integer, got ${n}`);
    }
    this.entityIdCounter = n;
  }

  getPlayer(seat: PlayerSeat): Player {
    const p = this.players[seat as unknown as number];
    if (!p) throw new GameStateIntegrityError(`No player at seat ${seat}`);
    return p;
  }

  isTerminal(): boolean {
    return this.terminalState !== null;
  }

  attachCardDb(_db: unknown): void {
    throw new Error("Game.attachCardDb: SP4 CardDb integration required");
  }
}

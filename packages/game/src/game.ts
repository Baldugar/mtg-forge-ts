// SPDX-License-Identifier: GPL-3.0-or-later
// Top-level Game object: composes lobby participants into Players, owns the
// shared zones (exile, ante, and later stack), per-Game mutable flags, and
// the entity-id allocator. Consumers construct with a SeededRng so every
// mutation is deterministic.
//
// Task 37 will replace `sharedZones.stack: unknown` with a concrete Stack
// instance. SP4 will replace `attachCardDb` with the real CardDb integration.
import type { EntityId, LobbyPlayer, PhaseStep, PlayerSeat, Rng } from "@mtg-forge-ts/core";
import {
  GameStateIntegrityError,
  PhaseStep as Phase,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { GameFlags } from "./game-flags.js";
import { createDefaultFlags } from "./game-flags.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Player } from "./player.js";
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

  readonly players: Player[];
  // `stack` is typed `unknown` pending Task 37's Stack class; Task 37 will
  // widen the type and populate the slot at construction time.
  readonly sharedZones: { stack: unknown; exile: Exile; ante: Ante };
  readonly flags: GameFlags;
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
      (lp, i) => new Player(mkPlayerSeat(i), lp, opts.rules.teamAssignments?.[i] ?? i),
    );
    this.sharedZones = {
      stack: null,
      exile: new Exile(ZoneType.Exile, null),
      ante: new Ante(ZoneType.Ante, null),
    };
    this.flags = createDefaultFlags();
  }

  newEntityId(): EntityId {
    return mkEntityId(this.entityIdCounter++);
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

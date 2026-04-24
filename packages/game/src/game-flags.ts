// SPDX-License-Identifier: GPL-3.0-or-later
// Transient, per-Game mutable flags: day/night, monarch, city's blessing,
// ring/speed/dungeon state, commander tracking, per-turn counters, etc. The
// interface itself uses mutable fields (engine mutates in place). `readonly`
// is intentionally absent from the Map/Set fields so effect handlers can
// mutate them without copy-on-write overhead.
import type { EntityId, PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";

export interface GameFlags {
  dayNight: "day" | "night" | "neither";
  monarch: PlayerSeat | null;
  initiative: PlayerSeat | null;
  cityBlessing: Set<PlayerSeat>;
  ringBearer: Map<PlayerSeat, EntityId | null>;
  ringLevel: Map<PlayerSeat, 0 | 1 | 2 | 3 | 4>;
  speedLevel: Map<PlayerSeat, 0 | 1 | 2 | 3 | 4>;
  currentDungeon: Map<PlayerSeat, { card: EntityId; position: string } | null>;
  commandersOwnedByPlayer: Map<PlayerSeat, EntityId[]>;
  commanderCastCount: Map<EntityId, number>;
  commanderDamage: Map<EntityId, Map<PlayerSeat, number>>;
  firstTurnDrawSkipped: Map<PlayerSeat, boolean>;
  mulligansTaken: Map<PlayerSeat, number>;
  landsPlayedThisTurn: Map<PlayerSeat, number>;
  spellsCastThisTurn: Map<PlayerSeat, number>;
  turnsTakenThisTurn: number;
  skippedPhases: PhaseStep[];
  activeTeamForTeamPlay: number | null;
  seatEliminated: Map<PlayerSeat, boolean>;
  // stickers / attractions are typed by SP7; holding the slot as unknown
  // keeps the shape stable.
  stickers: unknown[];
  attractions: Map<PlayerSeat, unknown>;
  // SP2 Milestone W Task 74 — per-turn tracking backing the "this turn"
  // predicates used by triggers and static effects. Reset to defaults at
  // the end of each turn by PhaseHandler.
  // `countersAddedThisTurn` maps cardId → total counters added across the
  // turn (any kind; triggers like Proliferate-synergy "whenever a counter
  // is put on X" care about the count, not the kind).
  // `leftBattlefieldThisTurn` is the set of cards whose last zone change
  // this turn moved them OFF the battlefield; backs "dies this turn" and
  // "this creature left the battlefield" checks.
  // `topLibsCast` is the set of cards whose most recent cast originated
  // from the TOP of the library (cascade, impulse-from-library, cascading
  // miracles). Cleared at turn end; Bolas's Citadel-style triggers read it.
  countersAddedThisTurn: Map<EntityId, number>;
  leftBattlefieldThisTurn: Set<EntityId>;
  topLibsCast: Set<EntityId>;
}

export const createDefaultFlags = (): GameFlags => ({
  dayNight: "neither",
  monarch: null,
  initiative: null,
  cityBlessing: new Set(),
  ringBearer: new Map(),
  ringLevel: new Map(),
  speedLevel: new Map(),
  currentDungeon: new Map(),
  commandersOwnedByPlayer: new Map(),
  commanderCastCount: new Map(),
  commanderDamage: new Map(),
  firstTurnDrawSkipped: new Map(),
  mulligansTaken: new Map(),
  landsPlayedThisTurn: new Map(),
  spellsCastThisTurn: new Map(),
  turnsTakenThisTurn: 0,
  skippedPhases: [],
  activeTeamForTeamPlay: null,
  seatEliminated: new Map(),
  stickers: [],
  attractions: new Map(),
  countersAddedThisTurn: new Map(),
  leftBattlefieldThisTurn: new Set(),
  topLibsCast: new Set(),
});

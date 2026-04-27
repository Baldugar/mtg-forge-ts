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
  // Wave 32 — per-controller counter of "permanents that left the
  // battlefield under your control this turn", powering Revolt (CR-
  // style "a permanent you controlled left the battlefield this turn").
  // Incremented by game-action.ts moveTo on Battlefield→anywhere
  // transitions, keyed by the card's controllerSeat captured BEFORE
  // the move applies. Reset to empty at TurnEnded by phase-handler.
  permanentsLeftBfThisTurn: Map<PlayerSeat, number>;
  // Wave 15 — AddTurnEffect queues extra turns here. PhaseHandler drains
  // the queue at end of turn and pushes one isExtra=true Turn to the front
  // of its TurnQueue per entry (CR 500.7: extra turns fire BEFORE the next
  // scheduled turn). The slot lives on Game.flags rather than directly on
  // PhaseHandler because effect handlers reach the Game (not the handler).
  pendingExtraTurns: PlayerSeat[];
  // Wave 18 — turn order direction. Forge's `SP$ ReverseTurnOrder` toggles
  // this. PhaseHandler reads it when computing the next active player.
  // "forward" = clockwise / seat ascending, "reverse" = counter-clockwise.
  turnOrder: "forward" | "reverse";
  // Wave 45 — Initiative dungeon (Undercity) tracker. CR 906.4c says the
  // initiative-holder ventures into the Undercity at the beginning of their
  // upkeep. The full dungeon graph (10 rooms with per-room effects) lives
  // in Forge's `initiative.txt`; for MVP we track only the room index
  // (1..10, 0 = "not yet entered"). Each call to grantInitiative or the
  // upkeep advance bumps the index modulo 10. Per-room effects are
  // // TODO(advanced): hook room-specific abilities once the dungeon
  // data structure lands.
  undercityRoom: number;
  // Wave 27 — Day/Night auto-transition support (CR 726.4). Snapshot of the
  // previous turn's `spellsCastThisTurn` taken at TurnEnded so the upkeep
  // transition logic on the FOLLOWING turn can read "the previous turn's
  // controller cast N non-land spells". `lastTurnActiveSeat` records whose
  // turn was just completed so the upkeep logic knows whose count to read.
  lastTurnSpellsCast: Map<PlayerSeat, number>;
  lastTurnActiveSeat: PlayerSeat | null;
  // Wave 51 — per-turn / per-game stat trackers backing the matching SVar
  // selectors (Count$YouDrewThisTurn, Count$LifeYouLostThisTurn, etc.).
  // All maps are reset on TurnEnded by phase-handler. They are NOT
  // serialized — restoring mid-turn from a snapshot resets them to empty,
  // which is acceptable because their consumers (SVar evaluators) re-read
  // live counts and snapshot tests don't span turns.
  cardsDrawnThisTurn: Map<PlayerSeat, number>;
  lifeGainedThisTurn: Map<PlayerSeat, number>;
  lifeLostThisTurn: Map<PlayerSeat, number>;
  cardsEnteredThisTurn: Map<PlayerSeat, number>;
  lastTurnCardsEntered: Map<PlayerSeat, number>;
  attackersDeclaredThisTurn: Map<PlayerSeat, number>;
  surveiledThisTurn: Map<PlayerSeat, number>;
  flippedCoinsThisTurn: Map<PlayerSeat, number>;
  rolledDiceThisTurn: Map<PlayerSeat, number[]>;
  countersRemovedThisTurn: number;
  leftGraveyardThisTurn: Set<EntityId>;
  // Wave 51 — global "a creature died this turn" counter for Morbid. Forge
  // tracks this globally (any creature dying anywhere on the battlefield).
  // Reset on TurnEnded.
  creaturesDiedThisTurn: number;
  // Wave 51 — per-game spell cast counter (Count$YouCastThisGame). Never
  // resets across turns; only reset on game start.
  spellsCastThisGame: Map<PlayerSeat, number>;
  // Wave 59 — per-controller "combat damage dealt by your creatures this
  // turn" tracker, backing the Freerunning alt-cost availability gate
  // ("you may cast this spell for its freerunning cost if a player was
  // dealt combat damage by one of your creatures this turn"). Reset on
  // TurnEnded by phase-handler.
  combatDamageDealtThisTurn: Map<PlayerSeat, number>;
  // Wave 56 — side-channel for the ReplaceEffect family. When a parent
  // replacement's apply() runs an SVar that resolves to a `DB$ Replace*`
  // effect handler (ReplaceEffect / ReplaceDamage / ReplaceMana /
  // ReplaceToken / ReplaceCounter / ReplaceSplitDamage), the parent stamps
  // the in-flight intent into this slot before invoking the SVar dispatch
  // and reads it back afterwards. This avoids threading the intent through
  // the SpellAbility resolver signature (which would balloon the SP1
  // SpellAbility surface for one narrow use). Set transiently within
  // applyWithReplacements; cleared after the SVar resolves (whether or
  // not the slot was touched). null when no replacement is mid-flight.
  // Not snapshotted: the slot is only meaningful inside an apply() boundary.
  activeReplacementIntent: unknown;
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
  permanentsLeftBfThisTurn: new Map(),
  pendingExtraTurns: [],
  turnOrder: "forward",
  lastTurnSpellsCast: new Map(),
  lastTurnActiveSeat: null,
  undercityRoom: 0,
  // Wave 51 — per-turn / per-game stat trackers.
  cardsDrawnThisTurn: new Map(),
  lifeGainedThisTurn: new Map(),
  lifeLostThisTurn: new Map(),
  cardsEnteredThisTurn: new Map(),
  lastTurnCardsEntered: new Map(),
  attackersDeclaredThisTurn: new Map(),
  surveiledThisTurn: new Map(),
  flippedCoinsThisTurn: new Map(),
  rolledDiceThisTurn: new Map(),
  countersRemovedThisTurn: 0,
  leftGraveyardThisTurn: new Set(),
  creaturesDiedThisTurn: 0,
  spellsCastThisGame: new Map(),
  // Wave 59 — Freerunning availability tracker.
  combatDamageDealtThisTurn: new Map(),
  // Wave 56 — replacement-intent side channel. Default null (no apply() in flight).
  activeReplacementIntent: null,
});

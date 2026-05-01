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
  // Wave 45 / Wave 70.B — Initiative dungeon (Undercity) tracker. CR 906.4c
  // says the initiative-holder ventures into the Undercity at the
  // beginning of their upkeep. Forge's `tokenscripts/undercity.txt` lists
  // 9 rooms with per-room effects; we track the room index (1..9, 0 =
  // "not yet entered"). Each call to grantInitiative or the upkeep advance
  // bumps the index modulo 9. Per-room printed effects fire after the
  // UndercityRoomEntered emit via `applyUndercityRoomEffect` (Wave 70.B).
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
  // Wave 60.D — per-seat counter of pending extra combat phases. Bumped
  // by the AB$ AdditionalCombat effect (Aggravated Assault / Relentless
  // Assault / Hellkite Charger / Combat Celebrant / Savage Beating /
  // Seize the Day) and by the AdditionalCombatPhase static (Aurelia, the
  // Warleader emblem form). Consumed (decremented) one at a time by the
  // phase handler at end-of-combat; each consumption injects an extra
  // combat block via PhaseSequence.injectExtraCombat. CR 506. Reset on
  // TurnEnded — a leftover counter does not roll over to the next turn
  // (matches Forge's semantics: the trigger only schedules the bonus
  // combat for THIS turn).
  pendingAdditionalCombatPhases: Map<PlayerSeat, number>;
  // Wave 60.G — per-seat counter of pending additional untap steps queued
  // for the matched player's NEXT untap step (CR 502 / Awakening Zone /
  // Time Vault analogues). Stamped at static-activation time by the
  // AdditionalUntapStep handler; consumed at the START of the canonical
  // untap-step turn-based actions (Wave 99 — CR 502.2 ordering: extra
  // untap loops run BEFORE the normal untap pass).
  // Reset on TurnEnded — a leftover counter does not roll over to the
  // next turn (matches Forge: the static stamps once per activation +
  // re-activation in the next turn re-stamps; the counter is per-turn).
  pendingAdditionalUntapSteps: Map<PlayerSeat, number>;
  // Wave 66 — per-seat "have you already activated your companion's
  // 3-mana once-per-game tutor this game?" flag (CR 702.139b — "Once per
  // game, that player may pay {3} as a special action to put their
  // companion from outside the game into their hand"). Stamped when the
  // synthesized companion activated SA resolves; consulted as an
  // availability gate the next time the same SA is presented. NOT reset
  // per-turn — strictly per-game. Default empty (no seat has used their
  // companion yet).
  companionUsedThisGame: Map<PlayerSeat, boolean>;
  // Wave 70.I — per-card loyalty-ability activation counter for the
  // current turn (CR 606.5b: "no more than one of a planeswalker's
  // loyalty abilities can be activated each turn"). Keyed by the
  // planeswalker's EntityId; default cap is 1, extended by NumLoyaltyAct
  // statics (Carth the Lion / The Chain Veil / Oath of Teferi). The
  // activate-time gate increments the counter AFTER cost payment +
  // before stack push (so a rejected activation does not consume a
  // count). Reset at the cleanup step (matches the per-turn semantics).
  loyaltyActivationsThisTurn: Map<EntityId, number>;
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
  // Wave 60.D — per-seat extra-combat-phase counter.
  pendingAdditionalCombatPhases: new Map(),
  // Wave 60.G — per-seat extra-untap-step counter.
  pendingAdditionalUntapSteps: new Map(),
  // Wave 66 — per-seat companion-activation tracker (once-per-game).
  companionUsedThisGame: new Map(),
  // Wave 70.I — per-card loyalty-activation counter (CR 606.5b).
  loyaltyActivationsThisTurn: new Map(),
  // Wave 56 — replacement-intent side channel. Default null (no apply() in flight).
  activeReplacementIntent: null,
});

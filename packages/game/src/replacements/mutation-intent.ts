// SPDX-License-Identifier: GPL-3.0-or-later
// Mutation-intent constructors + identifiers. The core `MutationIntent` is
// an opaque `{ kind: string; ...payload }` shape; this file pins the kinds
// GameAction/CombatHandler actually produce so replacements can match on
// them safely.
//
// New intent kinds land here rather than in core because game-package
// mutation shapes are internal to the engine — replacements that match
// them are SP3 card-specific abilities.
import type { CounterType, EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";

export const INTENT_KINDS = {
  Damage: "damage",
  LifeChange: "lifeChange",
  DrawCards: "drawCards",
  MoveTo: "moveTo",
  AddCounter: "addCounter",
  RemoveCounter: "removeCounter",
  Tap: "tap",
  Untap: "untap",
  Destroy: "destroy",
  Exile: "exile",
  Sacrifice: "sacrifice",
  Mill: "mill",
  ControlChange: "controlChange",
  Attach: "attach",
  Unattach: "unattach",
  // SP3 expansion — 24 new intent kinds matching Forge ReplacementType
  Scry: "scry",
  Proliferate: "proliferate",
  Cascade: "cascade",
  ProduceMana: "produceMana",
  Planeswalk: "planeswalk",
  SetInMotion: "setInMotion",
  Learn: "learn",
  Explore: "explore",
  GameWin: "gameWin",
  GameLoss: "gameLoss",
  DeclareBlocker: "declareBlocker",
  AssembleContraption: "assembleContraption",
  AssignDealDamage: "assignDealDamage",
  Attached: "attached",
  LifeReduced: "lifeReduced",
  LoseMana: "loseMana",
  PayLife: "payLife",
  PlanarDiceResult: "planarDiceResult",
  RollDice: "rollDice",
  RollPlanarDice: "rollPlanarDice",
  TurnFaceUp: "turnFaceUp",
  Transform: "transform",
  BeginPhase: "beginPhase",
  BeginTurn: "beginTurn",
} as const;

export type IntentKind = (typeof INTENT_KINDS)[keyof typeof INTENT_KINDS];

// Typed intent shapes — replacements that want to narrow can assert the kind.
export interface DamageIntent {
  readonly kind: "damage";
  readonly sourceId: EntityId;
  readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
  readonly targetId: EntityId | PlayerSeat;
  readonly amount: number;
  readonly isCombat: boolean;
}
export interface LifeChangeIntent {
  readonly kind: "lifeChange";
  readonly seat: PlayerSeat;
  readonly delta: number;
  readonly cause: string;
}
export interface DrawCardsIntent {
  readonly kind: "drawCards";
  readonly seat: PlayerSeat;
  readonly count: number;
}
export interface MoveToIntent {
  readonly kind: "moveTo";
  readonly cardId: EntityId;
  readonly toZone: ZoneType;
  readonly toSeat: PlayerSeat | null;
  readonly cause: string;
}
export interface AddCounterIntent {
  readonly kind: "addCounter";
  readonly cardId: EntityId;
  readonly counterType: CounterType;
  readonly amount: number;
  readonly sourceId: EntityId | null;
}
export interface RemoveCounterIntent {
  readonly kind: "removeCounter";
  readonly cardId: EntityId;
  readonly counterType: CounterType;
  readonly amount: number;
  readonly sourceId: EntityId | null;
}
export interface TapIntent {
  readonly kind: "tap";
  readonly cardId: EntityId;
}
export interface UntapIntent {
  readonly kind: "untap";
  readonly cardId: EntityId;
}
export interface DestroyIntent {
  readonly kind: "destroy";
  readonly cardId: EntityId;
  readonly sourceId: EntityId | null;
  readonly cause: "damage" | "sba" | "effect";
}
export interface ExileIntent {
  readonly kind: "exile";
  readonly cardId: EntityId;
  readonly sourceId: EntityId | null;
}
export interface SacrificeIntent {
  readonly kind: "sacrifice";
  readonly cardId: EntityId;
  readonly playerSeat: PlayerSeat;
  readonly sourceId: EntityId | null;
}
export interface MillIntent {
  readonly kind: "mill";
  readonly seat: PlayerSeat;
  readonly count: number;
}
export interface ControlChangeIntent {
  readonly kind: "controlChange";
  readonly cardId: EntityId;
  readonly newController: PlayerSeat;
  readonly sourceId: EntityId | null;
}
// SP2 Milestone K Task 42 — Aura/Equipment/Fortification attach/unattach.
// `cause` tracks provenance so observers can distinguish cast-time
// attachment ("equipped as you cast it", enchant resolution) from static-
// granted re-attachment and SBA-driven unattachment. UnattachIntent's
// `reason` mirrors the same provenance split: sba covers CR 704.5o/p/q
// equipment/fortification unattach, targetLeft covers
// untilXLeavesBattlefield-style forced detachment, effect covers
// scripted unequip activated abilities.
export interface AttachIntent {
  readonly kind: "attach";
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
  readonly cause: "cast" | "static" | "sba" | "activated";
}
export interface UnattachIntent {
  readonly kind: "unattach";
  readonly sourceId: EntityId;
  readonly reason: "sba" | "targetLeft" | "effect";
}

// SP3 expansion — 24 new intent shapes matching Forge ReplacementType.
// Additive; existing GameAction paths unchanged. SP3 effect handlers
// emit the new shapes.
export interface ScryIntent {
  readonly kind: "scry";
  readonly seat: PlayerSeat;
  readonly amount: number;
}
export interface SurveilIntent {
  readonly kind: "surveil";
  readonly seat: PlayerSeat;
  readonly amount: number;
}
export interface ProliferateIntent {
  readonly kind: "proliferate";
  readonly seat: PlayerSeat;
}
export interface CascadeIntent {
  readonly kind: "cascade";
  readonly sourceId: EntityId;
  readonly seat: PlayerSeat;
  readonly triggerCmc: number;
}
export interface ProduceManaIntent {
  readonly kind: "produceMana";
  readonly seat: PlayerSeat;
  readonly sourceId: EntityId;
  readonly symbols: readonly string[];
}
export interface PlaneswalkIntent {
  readonly kind: "planeswalk";
  readonly seat: PlayerSeat;
}
export interface SetInMotionIntent {
  readonly kind: "setInMotion";
  readonly schemeId: EntityId;
  readonly seat: PlayerSeat;
}
export interface LearnIntent {
  readonly kind: "learn";
  readonly seat: PlayerSeat;
}
export interface ExploreIntent {
  readonly kind: "explore";
  readonly cardId: EntityId;
  readonly seat: PlayerSeat;
}
export interface GameWinIntent {
  readonly kind: "gameWin";
  readonly seat: PlayerSeat;
  readonly cause: string;
}
export interface GameLossIntent {
  readonly kind: "gameLoss";
  readonly seat: PlayerSeat;
  readonly cause: string;
}
export interface DeclareBlockerIntent {
  readonly kind: "declareBlocker";
  readonly blockerId: EntityId;
  readonly attackerIds: readonly EntityId[];
}
export interface AssembleContraptionIntent {
  readonly kind: "assembleContraption";
  readonly seat: PlayerSeat;
}
export interface AssignDealDamageIntent {
  readonly kind: "assignDealDamage";
  readonly sourceId: EntityId;
  readonly assignments: readonly { readonly targetId: EntityId; readonly amount: number }[];
}
export interface AttachedIntent {
  readonly kind: "attached";
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
}
export interface LifeReducedIntent {
  readonly kind: "lifeReduced";
  readonly seat: PlayerSeat;
  readonly amount: number;
  readonly sourceId: EntityId | null;
}
export interface LoseManaIntent {
  readonly kind: "loseMana";
  readonly seat: PlayerSeat;
  readonly symbols: readonly string[];
}
export interface PayLifeIntent {
  readonly kind: "payLife";
  readonly seat: PlayerSeat;
  readonly amount: number;
}
export interface PlanarDiceResultIntent {
  readonly kind: "planarDiceResult";
  readonly seat: PlayerSeat;
  readonly face: "chaos" | "planeswalk" | "blank";
}
export interface RollDiceIntent {
  readonly kind: "rollDice";
  readonly seat: PlayerSeat;
  readonly sides: number;
  readonly count: number;
}
export interface RollPlanarDiceIntent {
  readonly kind: "rollPlanarDice";
  readonly seat: PlayerSeat;
}
export interface TurnFaceUpIntent {
  readonly kind: "turnFaceUp";
  readonly cardId: EntityId;
}
export interface TransformIntent {
  readonly kind: "transform";
  readonly cardId: EntityId;
}
export interface BeginPhaseIntent {
  readonly kind: "beginPhase";
  readonly seat: PlayerSeat;
  readonly phase: string;
}
export interface BeginTurnIntent {
  readonly kind: "beginTurn";
  readonly seat: PlayerSeat;
}

// Union of all known intent shapes (non-exhaustive; GameAction may emit
// additional kinds — replacements that don't recognize the kind should
// decline via matches() returning false).
export type KnownIntent =
  | DamageIntent
  | LifeChangeIntent
  | DrawCardsIntent
  | MoveToIntent
  | AddCounterIntent
  | RemoveCounterIntent
  | TapIntent
  | UntapIntent
  | DestroyIntent
  | ExileIntent
  | SacrificeIntent
  | MillIntent
  | ControlChangeIntent
  | AttachIntent
  | UnattachIntent
  | ScryIntent
  | SurveilIntent
  | ProliferateIntent
  | CascadeIntent
  | ProduceManaIntent
  | PlaneswalkIntent
  | SetInMotionIntent
  | LearnIntent
  | ExploreIntent
  | GameWinIntent
  | GameLossIntent
  | DeclareBlockerIntent
  | AssembleContraptionIntent
  | AssignDealDamageIntent
  | AttachedIntent
  | LifeReducedIntent
  | LoseManaIntent
  | PayLifeIntent
  | PlanarDiceResultIntent
  | RollDiceIntent
  | RollPlanarDiceIntent
  | TurnFaceUpIntent
  | TransformIntent
  | BeginPhaseIntent
  | BeginTurnIntent;

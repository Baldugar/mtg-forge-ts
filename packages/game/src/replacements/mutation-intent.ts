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

// Union of all known intent shapes (non-exhaustive; GameAction may emit
// additional kinds — replacements that don't recognize the kind should
// decline via matches() returning false).
export type KnownIntent =
  | DamageIntent
  | LifeChangeIntent
  | DrawCardsIntent
  | MoveToIntent
  | AddCounterIntent
  | RemoveCounterIntent;

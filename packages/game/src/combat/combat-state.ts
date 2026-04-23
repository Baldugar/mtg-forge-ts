// SPDX-License-Identifier: GPL-3.0-or-later
// CombatState — the single source of truth for combat-in-progress data.
// Lives on CombatHandler; ONLY CombatHandler mutates it (per master spec §3
// "three mutators": GameAction, CombatHandler, subsystem-internal). Maps are
// keyed by EntityId so SP2's damage-dealing generator can resolve attackers,
// blockers, blocker ordering, and damage assignments by id.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";

export type DefenderTarget =
  | { readonly kind: "player"; readonly seat: PlayerSeat }
  | { readonly kind: "planeswalker"; readonly id: EntityId }
  | { readonly kind: "battle"; readonly id: EntityId };

export interface AttackerInfo {
  readonly attackerId: EntityId;
  readonly defender: DefenderTarget;
  readonly isTapped: boolean;
}

export interface BlockerInfo {
  readonly blockerId: EntityId;
  // A blocker can block multiple attackers under banding / melee variants.
  readonly attackerIds: readonly EntityId[];
}

export interface CombatState {
  // `readonly` on Map fields means the REFERENCE is immutable (cannot be
  // reassigned). Map contents are mutable — intentional, because SP2's
  // CombatHandler mutates them during combat construction.
  readonly attackers: Map<EntityId, AttackerInfo>;
  readonly blockers: Map<EntityId, BlockerInfo>;
  // attackerId -> ordered blockers (CR 509.2 damage assignment order).
  readonly blockerOrdering: Map<EntityId, EntityId[]>;
  readonly damageAssignments: Map<EntityId, Array<{ targetId: EntityId; amount: number }>>;
  // Flipped between first-strike and regular damage sub-steps by SP2's
  // combat walker. Mutable (not readonly) for that reason.
  firstStrikeSplitActive: boolean;
}

export const createCombatState = (): CombatState => ({
  attackers: new Map(),
  blockers: new Map(),
  blockerOrdering: new Map(),
  damageAssignments: new Map(),
  firstStrikeSplitActive: false,
});

export const combatStateToJSON = (s: CombatState): unknown => ({
  attackers: [...s.attackers.entries()],
  blockers: [...s.blockers.entries()],
  blockerOrdering: [...s.blockerOrdering.entries()],
  damageAssignments: [...s.damageAssignments.entries()],
  firstStrikeSplitActive: s.firstStrikeSplitActive,
});

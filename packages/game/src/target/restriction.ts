// SPDX-License-Identifier: GPL-3.0-or-later
// CR 601/608 target restriction — the rule the source ability publishes
// about who it's willing to target. SP2 models a structured core subset
// sufficient for most published cards; SP3 extends via DSL-driven filters
// for complex conditional restrictions.
//
// Forge references:
//   - forge.game.spellability.TargetRestrictions
//   - forge.game.ability.AbilityUtils#isValidTarget
import type { CardType, Color, EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";

/**
 * Whose cards/players the restriction considers eligible, relative to the
 * source ability's controller. "you" = same seat; "opponent" = different
 * seat; "any" = no controller constraint.
 */
export type ControllerScope = "you" | "opponent" | "any";

/**
 * TargetRestriction — the structured rule a source ability publishes. The
 * player's selection (TargetChoices) is validated against this rule both at
 * cast time (CR 601.2c) and at resolve time (CR 608.2b) by TargetSystem.
 */
export interface TargetRestriction {
  // Whose cards/players are eligible relative to the ability's controller.
  readonly controllerScope: ControllerScope;
  // Only cards in these zones are eligible. Players are always eligible
  // for player-targeted abilities (see mayTargetPlayers).
  readonly permitZones: ReadonlySet<ZoneType>;
  // Types the target MUST have at least one of (empty set = no type constraint).
  readonly permitTypes: ReadonlySet<CardType>;
  // Types the target MUST NOT have (for "target nonartifact creature" etc).
  readonly forbidTypes: ReadonlySet<CardType>;
  // Wave 12 — colors the target MUST NOT have any of. Empty/absent = no
  // color constraint. Used by ValidTgts$ Creature.nonBlack / nonRed / etc.
  // Card colors come from `LayerEngine.computeCharacteristics(id).colors`
  // (Layer 5 = applied) so devotion / animate / become-X effects compose.
  readonly forbidColors?: ReadonlySet<Color>;
  // Wave 12 — when true, the target MUST have at least one color (i.e.,
  // colorless cards are excluded). Used by ValidTgts$ Creature.nonColorless.
  readonly forbidColorless?: boolean;
  // If set, target cannot have protection from any of these color/type keys.
  // SP2 has no parser yet; placeholder slot so the shape is stable.
  readonly protectionKeywords?: readonly string[];
  // If true, target cannot be chosen if it has shroud/hexproof respectively.
  readonly shroud?: boolean;
  readonly hexproof?: boolean;
  // Number of distinct targets required.
  readonly minTargets: number;
  readonly maxTargets: number;
  // If present, the ability divides X damage among the chosen targets.
  // Sum of `divisions` values must equal `amount`.
  readonly divideX?: { readonly amount: number };
  // If true, the ability may target players (not just cards).
  readonly mayTargetPlayers: boolean;
  // If the ability's own source card is ineligible ("target other creature").
  readonly forbidSelfSource?: boolean;
}

/**
 * A reference to a single target — either a Card (by EntityId) or a Player
 * (by seat). Kept as a discriminated union so exhaustiveness checks catch
 * new target kinds (planeswalker loyalty, stack items, etc.) as SP-scope
 * grows.
 */
export type TargetRef =
  | { readonly kind: "card"; readonly id: EntityId }
  | { readonly kind: "player"; readonly seat: PlayerSeat };

/**
 * TargetChoices — the player's submitted selection. `targets` is a list of
 * TargetRefs (cards + players mixed). `divisions` maps target-index →
 * amount for "divide X damage"-style spells; sum must match divideX.amount
 * on the restriction. Keys are numeric in TS but emit as strings at
 * runtime — consumers index by number and TS normalizes the lookup.
 */
export interface TargetChoices {
  readonly targets: readonly TargetRef[];
  readonly divisions?: Readonly<Record<number, number>>;
}

/** Convenience constructor for a card target. */
export const cardTarget = (id: EntityId): TargetRef => ({ kind: "card", id });

/** Convenience constructor for a player target. */
export const playerTarget = (seat: PlayerSeat): TargetRef => ({ kind: "player", seat });

/** Type guard — narrows a TargetRef to its card variant. */
export const isCardTarget = (r: TargetRef): r is { kind: "card"; id: EntityId } => r.kind === "card";

/** Type guard — narrows a TargetRef to its player variant. */
export const isPlayerTarget = (r: TargetRef): r is { kind: "player"; seat: PlayerSeat } =>
  r.kind === "player";

/**
 * Structural equality for TargetRef. Consumers use this rather than `===`
 * because refs are plain records that may have been reconstructed through
 * redirect() or JSON round-trip.
 */
export const refEquals = (a: TargetRef, b: TargetRef): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "card":
      return b.kind === "card" && a.id === b.id;
    case "player":
      return b.kind === "player" && a.seat === b.seat;
    default: {
      const _: never = a;
      throw new Error(`refEquals: unreachable ${JSON.stringify(_)}`);
    }
  }
};

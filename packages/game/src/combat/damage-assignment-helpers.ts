// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers used by CombatHandler.dealDamage to extract defender identity,
// attacker power (via LayerEngine), blocker toughness, and keyword presence.
//
// SP2 scope: `hasKeyword` consults a simple Card.keywords Set (seeded by
// tests and — eventually — SP3's keyword registry). Characteristics.abilities
// carries AbilityRef{id, grantedBy, origin} today, with no keyword string
// surface. When SP3 lands the keyword registry we drop this helper's
// Card.keywords fallback in favor of a Characteristics lookup.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { DefenderTarget } from "./combat-state.js";

export const defenderKind = (d: DefenderTarget): "player" | "planeswalker" | "battle" => {
  switch (d.kind) {
    case "player":
      return "player";
    case "planeswalker":
      return "planeswalker";
    case "battle":
      return "battle";
    default: {
      // Exhaustiveness guard — DefenderTarget is a three-variant union.
      const _never: never = d;
      throw new Error(`defenderKind: unreachable ${JSON.stringify(_never)}`);
    }
  }
};

export const defenderId = (d: DefenderTarget): EntityId | PlayerSeat => {
  switch (d.kind) {
    case "player":
      return d.seat;
    case "planeswalker":
    case "battle":
      return d.id;
    default: {
      const _never: never = d;
      throw new Error(`defenderId: unreachable ${JSON.stringify(_never)}`);
    }
  }
};

/**
 * Attacker power for combat-damage purposes. CR 104.3m: damage-dealing
 * creatures with power less than 0 deal no damage — clamp at 0 here so the
 * caller can filter with a single `power <= 0` check.
 */
export const attackerPower = (game: Game, attackerId: EntityId): number => {
  const chars = game.layerEngine.computeCharacteristics(attackerId);
  const p = chars.power ?? 0;
  return p < 0 ? 0 : p;
};

/**
 * Blocker toughness for minimum-lethal assignment (CR 702.17c). Null
 * toughness treated as 0 for assignment purposes — a non-creature caught
 * in the blocker list is pathological input, but we clamp rather than throw
 * so the validator surfaces the error as an illegal assignment higher up.
 */
export const creatureToughness = (game: Game, creatureId: EntityId): number => {
  const chars = game.layerEngine.computeCharacteristics(creatureId);
  return chars.toughness ?? 0;
};

/**
 * Keyword lookup — SP2 placeholder consulting Card.keywords directly. SP3's
 * keyword registry will expose these through Characteristics; at that point
 * this helper becomes a thin adapter over `chars.keywords.has(keyword)`.
 */
export const hasKeyword = (game: Game, cardId: EntityId, keyword: string): boolean => {
  const card = game.cards.get(cardId);
  if (!card) return false;
  return card.keywords?.has(keyword) ?? false;
};

/**
 * CR 702.26e — phased-out lookup. Phased-out permanents stay on the
 * battlefield for engine-internal tracking but are invisible to targeting,
 * triggers, and combat. SP2 Task 52 (phasing) reads `card.phased` directly
 * off the live Card; this wrapper exists so downstream filters in
 * target-system / trigger-registry / combat-handler get one import point.
 */
export const isPhasedOut = (game: Game, cardId: EntityId): boolean => {
  const card = game.cards.get(cardId);
  return card?.phased === true;
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers used by CombatHandler.dealDamage to extract defender identity,
// attacker power (via LayerEngine), blocker toughness, and keyword presence.
//
// SP2 scope: `hasKeyword` consults a simple Card.keywords Set (seeded by
// tests and — eventually — SP3's keyword registry). Characteristics.abilities
// carries AbilityRef{id, grantedBy, origin} today, with no keyword string
// surface. When SP3 lands the keyword registry we drop this helper's
// Card.keywords fallback in favor of a Characteristics lookup.
//
// Wave 70.D — `attackerPower` consults the CombatDamageToughness static
// (Doran, the Siege Tower / Assault Formation / Belligerent Brontodon)
// before reading chars.power; on match the layered toughness is
// returned instead. CR 702.95.
//
// Wave 70.N — `attackerPower` ALSO consults the AssignNoCombatDamage
// static (Sunhome Enforcer / Indomitable Ancients / "deals no combat
// damage" curses). On match the value is 0 — this short-circuits BEFORE
// CombatDamageToughness so 0 trumps any toughness substitution. CR 510.1d.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { usesToughnessForCombatDamage } from "../statics/wave70d-target-combat-gates.js";
import { assignsNoCombatDamage } from "../statics/wave70n-combat-gates.js";
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
 *
 * Wave 70.D — when a CombatDamageToughness static (CR 702.95) matches
 * the attacker, the Doran-shape rule kicks in: the attacker assigns
 * combat damage equal to its toughness rather than its power. The
 * toughness is read from the same layered characteristics view, also
 * clamped at 0 (CR 702.95 carries the same "less than 0 → no damage"
 * convention as power).
 *
 * Wave 70.N — when an AssignNoCombatDamage static (CR 510.1d) matches
 * the attacker, the value is 0 regardless of power or any
 * CombatDamageToughness substitution. AssignNoCombatDamage takes
 * precedence: in Forge, StaticAbilityAssignNoCombatDamage short-circuits
 * before CombatDamageToughness substitution, so 0 trumps the toughness
 * value.
 */
export const attackerPower = (game: Game, attackerId: EntityId): number => {
  // Wave 70.N — short-circuit: matched creatures assign 0 combat damage,
  // overriding the CombatDamageToughness substitution.
  if (assignsNoCombatDamage(game, attackerId)) return 0;
  const chars = game.layerEngine.computeCharacteristics(attackerId);
  const useToughness = usesToughnessForCombatDamage(game, attackerId);
  const raw = useToughness ? (chars.toughness ?? 0) : (chars.power ?? 0);
  return raw < 0 ? 0 : raw;
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
 * Keyword lookup — consults Card.keywords (intrinsic + activate-keyword-
 * registered) AND Layer 6 keyword grants (Wave 32 — Continuous statics
 * with AddKeyword$, e.g. Threshold). The two sources are unioned so
 * intrinsic Vigilance + a Threshold grant both resolve true even when
 * one is absent.
 *
 * Wave 60.F — Layer 6 RemoveKeyword$ effects subtract from the union.
 * A card that has baseline Flying + a removed Flying (e.g. Cessation
 * stripping Flying off creatures of a specific filter) ends up without
 * Flying for combat / SBA / target queries. Removal applies AFTER the
 * additive union so additions cannot un-remove a removal in the same
 * static; this matches Forge's Layer 6 ordering for negative keywords.
 */
export const hasKeyword = (game: Game, cardId: EntityId, keyword: string): boolean => {
  const card = game.cards.get(cardId);
  if (!card) return false;
  // Wave 60.F — short-circuit on negative keyword: if a Layer 6 removal
  // strips this keyword from the card, the answer is false regardless of
  // intrinsic / granted sources.
  if (game.layerEngine.effectiveKeywordRemovals(cardId).has(keyword)) return false;
  if (card.keywords?.has(keyword)) return true;
  // Wave 32 — Layer 6 keyword grants (Threshold, Wither/Infect roadmap).
  return game.layerEngine.effectiveGrantedKeywords(cardId).has(keyword);
};

/**
 * CR 702.26e — phased-out lookup. Phased-out permanents stay on the
 * battlefield for engine-internal tracking but are invisible to targeting,
 * triggers, and combat. SP2 Task 52 (phasing) reads `card.phased` directly
 * off the live Card; this wrapper exists so downstream filters in
 * target-system / trigger-registry / combat-handler get one import point.
 *
 * Wave 54 — also consult `card.phasedOut`. Two flags exist on Card:
 *   - `card.phased` is set by the phasing keyword's untap-step processor
 *     (per-turn phasing — Vanishing/Phasing K:Phasing).
 *   - `card.phasedOut` is set by Forge's `SP$ Phases` effect (Teferi's Veil,
 *     Tawnos's Coffin, etc. — direct phase-out).
 * Both have identical engine semantics per CR 702.26d/e: the card is
 * treated as if it doesn't exist. Reading both here means combat,
 * targeting, and SBA collectors all see the same view through a single
 * import point.
 */
export const isPhasedOut = (game: Game, cardId: EntityId): boolean => {
  const card = game.cards.get(cardId);
  if (!card) return false;
  return card.phased === true || card.phasedOut === true;
};

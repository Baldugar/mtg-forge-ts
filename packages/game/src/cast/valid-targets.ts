// SPDX-License-Identifier: GPL-3.0-or-later
// valid-targets.ts — parse Forge's ValidTgts$ filter string into a
// TargetRestriction that the cast pipeline's TargetSystem can enforce.
//
// Wave 4 scope: a subset of the Forge filter grammar sufficient for common
// competitive cards. Unsupported qualifiers fall through to "permit all".
//
// Grammar (simplified):
//   filter     := alternative ("," alternative)*    — comma = top-level OR
//   alternative := base ("." qualifier)*             — dot-chained qualifiers
//   base       := "Any" | "Permanent" | "Spell"
//               | "Creature" | "Artifact" | "Enchantment"
//               | "Land" | "Planeswalker" | "Battle"
//               | "Player" | "Card"
//   qualifier  := "YouCtrl" | "OppCtrl" | "OpponentCtrl"
//               | "nonCreature" | "nonArtifact" | "nonEnchantment"
//               | "nonLand" | "nonBlack" | "nonRed" | "nonGreen"
//               | "nonWhite" | "nonBlue" | "nonColorless"
//               | "Self" | ...
//
// Non-null assertion is avoided; unsupported forms return a permissive
// fallthrough restriction so unrecognised filters don't crash the game.
//
// Color-based filters (nonBlack etc) are stored as a `forbidColors` set on
// the restriction; nonColorless is stored as a `forbidColorless` boolean.
// Both are enforced by enumerateEligibleTargets via the layer-engine
// characteristics (Layer 5 = applied), so animate/become-X recolors compose.

import { CardType, Color, ZoneType } from "@mtg-forge-ts/core";
import type { TargetRestriction } from "../target/restriction.js";

// Battlefield is the default permit zone for permanents.
const BATTLEFIELD_ONLY = new Set([ZoneType.Battlefield]);
// Stack items for "Spell" filter.
const STACK_ONLY = new Set([ZoneType.Stack]);
// Any card zone (for "Card" / permissive filters).
const ALL_CARD_ZONES = new Set([
  ZoneType.Battlefield,
  ZoneType.Hand,
  ZoneType.Graveyard,
  ZoneType.Library,
  ZoneType.Exile,
  ZoneType.Stack,
]);

/**
 * Parse a raw ValidTgts$ value into a TargetRestriction.
 *
 * Handles the most common Forge filter forms. Unknown forms fall back to
 * a "permit any battlefield card" restriction so gameplay can continue.
 *
 * @param raw - e.g. "Creature.nonBlack", "Artifact,Enchantment", "Any"
 */
export const parseValidTgts = (raw: string): TargetRestriction => {
  const alternatives = raw.split(",").map((s) => s.trim());

  // For single-alternative filters, parse directly.
  if (alternatives.length === 1) {
    return parseSingleFilter(raw.trim());
  }

  // For multi-alternative (OR) filters, merge permitTypes from all arms
  // and union the results. ControllerScope defaults to "any", forbidTypes
  // is not accumulated (OR logic makes forbids moot).
  const permitTypes = new Set<CardType>();
  let mayTargetPlayers = false;
  for (const alt of alternatives) {
    const r = parseSingleFilter(alt.trim());
    for (const t of r.permitTypes) {
      permitTypes.add(t);
    }
    if (r.mayTargetPlayers) mayTargetPlayers = true;
  }
  return {
    controllerScope: "any",
    permitZones: BATTLEFIELD_ONLY,
    permitTypes,
    forbidTypes: new Set(),
    minTargets: 1,
    maxTargets: 1,
    mayTargetPlayers,
  };
};

const parseSingleFilter = (filter: string): TargetRestriction => {
  const parts = filter.split(".");
  const base = parts[0] ?? "Permanent";
  const qualifiers = parts.slice(1);

  // Resolve base → initial restriction.
  let restriction = baseRestriction(base);

  // Apply qualifiers in order. Each mutates the restriction clone.
  for (const q of qualifiers) {
    restriction = applyQualifier(restriction, q);
  }

  return restriction;
};

const baseRestriction = (base: string): TargetRestriction => {
  switch (base) {
    case "Any":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: true,
      };

    case "Player":
      return {
        controllerScope: "any",
        permitZones: new Set(), // players, not cards
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: true,
      };

    case "Permanent":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Spell":
      return {
        controllerScope: "any",
        permitZones: STACK_ONLY,
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Card":
      return {
        controllerScope: "any",
        permitZones: ALL_CARD_ZONES,
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Creature":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set([CardType.Creature]),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Artifact":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set([CardType.Artifact]),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Enchantment":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set([CardType.Enchantment]),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Land":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set([CardType.Land]),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Planeswalker":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set([CardType.Planeswalker]),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    case "Battle":
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set([CardType.Battle]),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };

    default:
      // Unknown base — fall back to permissive any-permanent.
      return {
        controllerScope: "any",
        permitZones: BATTLEFIELD_ONLY,
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      };
  }
};

const applyQualifier = (r: TargetRestriction, qualifier: string): TargetRestriction => {
  // Controller-scope qualifiers.
  if (qualifier === "YouCtrl") {
    return { ...r, controllerScope: "you" };
  }
  if (qualifier === "OppCtrl" || qualifier === "OpponentCtrl" || qualifier === "YouDontCtrl") {
    return { ...r, controllerScope: "opponent" };
  }
  // Type forbid qualifiers.
  if (qualifier === "nonCreature") {
    return { ...r, forbidTypes: new Set([...r.forbidTypes, CardType.Creature]) };
  }
  if (qualifier === "nonArtifact") {
    return { ...r, forbidTypes: new Set([...r.forbidTypes, CardType.Artifact]) };
  }
  if (qualifier === "nonEnchantment") {
    return { ...r, forbidTypes: new Set([...r.forbidTypes, CardType.Enchantment]) };
  }
  if (qualifier === "nonLand") {
    return { ...r, forbidTypes: new Set([...r.forbidTypes, CardType.Land]) };
  }
  // Wave 12 — color-forbid qualifiers. Each non<Color> appends its bit to
  // forbidColors; nonColorless flips the dedicated forbidColorless flag.
  // enumerateEligibleTargets reads chars.colors (Layer 5) to enforce.
  if (qualifier === "nonBlack") {
    return { ...r, forbidColors: new Set([...(r.forbidColors ?? []), Color.Black]) };
  }
  if (qualifier === "nonBlue") {
    return { ...r, forbidColors: new Set([...(r.forbidColors ?? []), Color.Blue]) };
  }
  if (qualifier === "nonRed") {
    return { ...r, forbidColors: new Set([...(r.forbidColors ?? []), Color.Red]) };
  }
  if (qualifier === "nonGreen") {
    return { ...r, forbidColors: new Set([...(r.forbidColors ?? []), Color.Green]) };
  }
  if (qualifier === "nonWhite") {
    return { ...r, forbidColors: new Set([...(r.forbidColors ?? []), Color.White]) };
  }
  if (qualifier === "nonColorless") {
    return { ...r, forbidColorless: true };
  }
  if (qualifier === "Self") {
    return { ...r, forbidSelfSource: false }; // Self = target is own source
  }
  // Unknown qualifier — pass through unchanged (permissive fallback).
  return r;
};

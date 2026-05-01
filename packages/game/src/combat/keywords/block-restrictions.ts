// SPDX-License-Identifier: GPL-3.0-or-later
// CR 509.1b — block legality checks before accepting declared blockers.
//
// Each restriction inspects the attacker + blocker keyword sets (and,
// for menace, the full block list for the attacker). This module is the
// single entry point for "can this blocker legally block that attacker?"
// — CombatHandler.declareBlockers reads it to reject illegal declarations.
//
// Coverage:
//   Task 49: flying (702.9) / reach (702.17) / menace (702.110) / skulk
//            (702.118) / protection (702.16 — B from DEBT).
//   Task 50: fear (702.36) / intimidate (702.13) / horsemanship (702.30) /
//            landwalk family (702.14).
//
// SP3 folds evasion-grant layer effects into Characteristics; this helper
// continues to consult hasKeyword so the keyword-string surface remains
// the single source of truth for Card.keywords + Characteristics alike.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { CardType, Color } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { isBlockingRestricted } from "../../statics/cant-must-may-extras.js";
import { ignoresLandWalk } from "../../statics/wave70f-combat-gates.js";
import { canBlockIfReach } from "../../statics/wave70p-gate-helpers.js";
import { canBlockWhileTapped } from "../../statics/wave78-gate-helpers.js";
import { attackerPower, hasKeyword } from "../damage-assignment-helpers.js";
import { hasProtectionFrom } from "./protection.js";

export interface BlockDeclaration {
  readonly blockerId: EntityId;
  readonly attackerIds: readonly EntityId[];
}

export interface BlockLegalityResult {
  readonly legal: boolean;
  readonly reason?: string;
}

const LEGAL: BlockLegalityResult = { legal: true };

const LANDWALK_SUFFIX = "walk";
const LANDWALK_TYPES: readonly string[] = [
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
  "desert",
  "wastes",
  "snow",
  "legendary",
];

/** Extract landwalk subtypes from a creature's keywords (e.g. "islandwalk" → "island"). */
const readLandwalks = (game: Game, creatureId: EntityId): readonly string[] => {
  const card = game.cards.get(creatureId);
  if (!card?.keywords) return [];
  const out: string[] = [];
  for (const kw of card.keywords) {
    const lower = kw.toLowerCase();
    if (!lower.endsWith(LANDWALK_SUFFIX)) continue;
    const base = lower.slice(0, -LANDWALK_SUFFIX.length);
    if (LANDWALK_TYPES.includes(base)) out.push(base);
  }
  return out;
};

/** Collect land subtypes on the battlefield controlled by `seat`. */
const collectLandSubtypes = (game: Game, seat: PlayerSeat): Set<string> => {
  const out = new Set<string>();
  for (const card of game.cards.values()) {
    if (card.controllerSeat !== seat) continue;
    const chars = game.layerEngine.computeCharacteristics(card.id);
    if (!chars.types.has(CardType.Land)) continue;
    for (const st of chars.subtypes) out.add(st.toLowerCase());
  }
  return out;
};

/**
 * Validate a single (blocker, attacker) pairing. `allBlocksOnAttacker`
 * is the full list of blockers declared against this attacker — menace
 * (CR 702.110) needs it.
 */
export const isBlockLegal = (
  game: Game,
  blocker: EntityId,
  attacker: EntityId,
  allBlocksOnAttacker: readonly EntityId[],
): BlockLegalityResult => {
  // Wave 50 — static-driven block restrictions (CantBlock + CantBlockBy).
  // Walks the cantMustMay registry. Rejected when (a) the blocker matches
  // any CantBlock subject filter, or (b) an active CantBlockBy matches
  // both the attacker (subject) and the blocker (auxFilter).
  if (isBlockingRestricted(game, attacker, blocker)) {
    return { legal: false, reason: "static block restriction" };
  }

  // Wave 78 — CR 509.1a — a tapped creature can't be declared as a
  // blocker. The BlockTapped static (Masako the Humorless shape)
  // bypasses this rejection: when an active static matches the
  // declared blocker, the rejection is suppressed and the block stands
  // even if `card.tapped === true`.
  const blockerCard = game.cards.get(blocker);
  if (blockerCard?.tapped === true && !canBlockWhileTapped(game, blocker)) {
    return { legal: false, reason: "tapped creatures can't block" };
  }

  // Flying (CR 702.9): attacker with flying can only be blocked by a
  // creature with flying or reach.
  //
  // Wave 70.P — CanBlockIfReach static (Dragon Hunter shape). When an
  // active static matches the (blocker, attacker) pairing, the flying
  // rejection is suppressed: the blocker may legally block the
  // attacker even if it has neither flying nor reach. Mirrors the Wave
  // 70.F IgnoreLandwalk pattern on the flying-keyword side.
  if (hasKeyword(game, attacker, "flying")) {
    if (
      !hasKeyword(game, blocker, "flying") &&
      !hasKeyword(game, blocker, "reach") &&
      !canBlockIfReach(game, blocker, attacker)
    ) {
      return { legal: false, reason: "flying requires flying/reach blocker" };
    }
  }

  // Menace (CR 702.110): can't be blocked except by two or more creatures.
  if (hasKeyword(game, attacker, "menace")) {
    if (allBlocksOnAttacker.length < 2) {
      return { legal: false, reason: "menace requires 2+ blockers" };
    }
  }

  // Skulk (CR 702.118): can't be blocked by creatures with greater power
  // than the attacker's.
  if (hasKeyword(game, attacker, "skulk")) {
    const attP = attackerPower(game, attacker);
    const blkP = attackerPower(game, blocker);
    if (blkP > attP) {
      return { legal: false, reason: "skulk rejects greater-power blocker" };
    }
  }

  // Protection (CR 702.16b — B from DEBT). Symmetric: either direction
  // blocks the block. A red attacker with protection from blockers' color
  // can't be blocked by that blocker; a blocker with protection from the
  // attacker's color can't block it.
  if (hasProtectionFrom(game, attacker, blocker) || hasProtectionFrom(game, blocker, attacker)) {
    return { legal: false, reason: "protection prevents block" };
  }

  // Horsemanship (CR 702.30): symmetric of flying but without a reach
  // analog — only horsemanship creatures can block a horsemanship attacker.
  if (hasKeyword(game, attacker, "horsemanship")) {
    if (!hasKeyword(game, blocker, "horsemanship")) {
      return { legal: false, reason: "horsemanship requires horsemanship blocker" };
    }
  }

  // Fear (CR 702.36): can't be blocked except by artifact and/or black
  // creatures.
  if (hasKeyword(game, attacker, "fear")) {
    const blkChars = game.layerEngine.computeCharacteristics(blocker);
    const isArtifact = blkChars.types.has(CardType.Artifact);
    const isBlack = (blkChars.colors.toJSON() & Color.Black) !== 0;
    if (!isArtifact && !isBlack) {
      return { legal: false, reason: "fear requires artifact/black blocker" };
    }
  }

  // Intimidate (CR 702.13): can't be blocked except by artifact and/or
  // creatures that share a color with the attacker.
  if (hasKeyword(game, attacker, "intimidate")) {
    const blkChars = game.layerEngine.computeCharacteristics(blocker);
    const attChars = game.layerEngine.computeCharacteristics(attacker);
    const isArtifact = blkChars.types.has(CardType.Artifact);
    const shareColor = (blkChars.colors.toJSON() & attChars.colors.toJSON()) !== 0;
    if (!isArtifact && !shareColor) {
      return { legal: false, reason: "intimidate requires artifact/shared-color blocker" };
    }
  }

  // Landwalk (CR 702.14 family): if the attacker has Xwalk and the
  // defending player (the blocker's controller) controls a land with
  // subtype X, the attacker can't be blocked at all by that defender.
  //
  // Wave 70.F — IgnoreLandwalk static (CR 702.13). When an active
  // static matches this (blocker, attacker) pairing, the landwalk
  // rejection is suppressed: the blocker may legally block the
  // attacker even though the attacker has a matching landwalk. Sphere
  // of Truth / Reverence / Suppression Field analogues.
  const landwalks = readLandwalks(game, attacker);
  if (landwalks.length > 0 && !ignoresLandWalk(game, blocker, attacker)) {
    const blockerCard = game.cards.get(blocker);
    if (blockerCard) {
      const defenderSubtypes = collectLandSubtypes(game, blockerCard.controllerSeat);
      for (const lw of landwalks) {
        if (defenderSubtypes.has(lw)) {
          return { legal: false, reason: `${lw}walk` };
        }
      }
    }
  }

  return LEGAL;
};

/**
 * Validate a list of block declarations. Returns ONLY the illegal
 * entries (empty array means all declarations are legal). Callers route
 * the result into whatever error-surfacing mechanism they prefer; the
 * function itself is pure.
 */
export const validateBlockDeclarations = (
  game: Game,
  declarations: readonly BlockDeclaration[],
): readonly BlockLegalityResult[] => {
  // Group declarations by attacker for menace / multi-blocker checks.
  const byAttacker = new Map<EntityId, EntityId[]>();
  for (const d of declarations) {
    for (const a of d.attackerIds) {
      const list = byAttacker.get(a) ?? [];
      list.push(d.blockerId);
      byAttacker.set(a, list);
    }
  }
  const results: BlockLegalityResult[] = [];
  for (const d of declarations) {
    for (const a of d.attackerIds) {
      const all = byAttacker.get(a) ?? [];
      const result = isBlockLegal(game, d.blockerId, a, all);
      if (!result.legal) results.push(result);
    }
  }
  return results;
};

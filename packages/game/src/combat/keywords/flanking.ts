// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.25 — Flanking. Whenever a creature without flanking blocks a
// creature with flanking, the blocker gets -1/-1 until end of turn (per
// flanking ability on the attacker — instances stack).
//
// SP2 scope: expose the "should a flanking debuff apply?" check + the
// count of flanking instances on the attacker. SP3 wires the actual
// Layer 7c until-EOT P/T effect via the block-declaration trigger path
// (Milestone J). Since SP2's keyword model is a Set<string> (presence,
// not multi-instance count), countFlankingOn returns 1 when present.
// SP3's keyword registry will expose per-instance counts and this helper
// becomes a thin adapter over `chars.keywords.countOf("flanking")`.
import type { EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { hasKeyword } from "../damage-assignment-helpers.js";

/** Number of distinct flanking instances on a creature (SP2: 0 or 1). */
export const countFlankingOn = (game: Game, creatureId: EntityId): number => {
  return hasKeyword(game, creatureId, "flanking") ? 1 : 0;
};

/**
 * Return true when the blocker should receive a flanking -1/-1 debuff:
 * attacker has flanking AND blocker does not. Non-flanking blocker of a
 * non-flanking attacker → false.
 */
export const shouldApplyFlankingDebuff = (game: Game, attackerId: EntityId, blockerId: EntityId): boolean => {
  return countFlankingOn(game, attackerId) > 0 && !hasKeyword(game, blockerId, "flanking");
};

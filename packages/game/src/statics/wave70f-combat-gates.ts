// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.F — query helpers for the three Wave-70.F static modes:
//   - UntapOtherPlayer              → shouldUntapDuringStep
//   - AssignCombatDamageAsUnblocked → assignsCombatDamageAsUnblocked
//   - IgnoreLandwalk                → ignoresLandWalk
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single boolean the consumer site uses to override the canonical
// rules behavior at the matching decision point.
//
// Read-side consumers:
//   - shouldUntapDuringStep         → phase-handler runUntapPass
//                                      (extends the per-card "should we
//                                       untap" gate to consider statics
//                                       that grant cross-player untap
//                                       during the active untap step)
//   - assignsCombatDamageAsUnblocked → combat-handler dealDamage
//                                      (blocked branch routes the damage
//                                       to the declared defender as if
//                                       unblocked when matched)
//   - ignoresLandWalk               → block-restrictions
//                                      (landwalk gate is bypassed when a
//                                       matching IgnoreLandwalk static
//                                       covers this blocker/attacker
//                                       pairing)
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E. The static registry already snapshots
// and restores cleanly, so walking the registry per-query is the right
// source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AssignCombatDamageAsUnblockedPayload } from "../static/handlers/assign-combat-damage-as-unblocked-static.js";
import type { IgnoreLandWalkPayload } from "../static/handlers/ignore-land-walk-static.js";
import type { UntapOtherPlayerPayload } from "../static/handlers/untap-other-player-static.js";

/**
 * True iff `cardId` should untap during `untappingSeat`'s untap step
 * because some active UntapOtherPlayer static matches both the card
 * and the player whose untap step is occurring (CR 502; Awakening /
 * Vedalken Orrery analogues).
 *
 * The phase-handler's runUntapPass calls this for every battlefield
 * card whose controller is NOT the active player (the canonical untap
 * loop already handles the active player's own permanents). Returning
 * true pulls the card into the active untap pass.
 */
export const shouldUntapDuringStep = (game: Game, cardId: EntityId, untappingSeat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("UntapOtherPlayer");
  for (const s of statics) {
    const payload = s.describe() as UntapOtherPlayerPayload;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.playerMatches(untappingSeat)) continue;
    return true;
  }
  return false;
};

/**
 * True iff `attackerId` should assign its combat damage as if unblocked
 * even when blockers are declared (CR 510; Bloodthorn Tine / Tempting
 * Wurm shapes). On match, the combat-handler routes the attacker's full
 * power to the declared defender instead of running the
 * defaultAssignment over blockers.
 *
 * Distinct from Trample (CR 702.19): trample assigns lethal-to-blockers
 * THEN spills excess to defender; this static routes ALL damage to
 * defender regardless of blocker survival.
 */
export const assignsCombatDamageAsUnblocked = (game: Game, attackerId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("AssignCombatDamageAsUnblocked");
  for (const s of statics) {
    const payload = s.describe() as AssignCombatDamageAsUnblockedPayload;
    if (payload.cardMatches(attackerId, game)) return true;
  }
  return false;
};

/**
 * Wave 112 — Detailed lookup for the combat-handler. Returns the
 * matched static's payload metadata so the consumer can honor
 * `Optional$ True` (controller MAY decline) and `CombatDamage$ N`
 * (route a fixed value instead of the attacker's full power) without
 * re-walking the registry.
 *
 * Returns the FIRST matching payload (Forge layering: the active gates
 * stack but the routing decision is a single "as if unblocked" event;
 * the first match wins for the override + optional fields). When no
 * match is in force, returns null — equivalent to
 * `assignsCombatDamageAsUnblocked` returning false.
 */
export interface AsUnblockedRouting {
  /** Whether the controller MAY decline the routing (Forge `Optional$ True`). */
  readonly optional: boolean;
  /**
   * Fixed damage to route instead of the attacker's full power, if any
   * (Forge `CombatDamage$ N`). undefined → use attacker's full power.
   */
  readonly combatDamageOverride: number | undefined;
}
export const asUnblockedRoutingFor = (game: Game, attackerId: EntityId): AsUnblockedRouting | null => {
  const statics = game.staticEffectRegistry.byMode("AssignCombatDamageAsUnblocked");
  for (const s of statics) {
    const payload = s.describe() as AssignCombatDamageAsUnblockedPayload;
    if (!payload.cardMatches(attackerId, game)) continue;
    return {
      optional: payload.optional,
      combatDamageOverride: payload.combatDamageOverride,
    };
  }
  return null;
};

/**
 * True iff the (blockerId, attackerId) pairing should ignore the
 * attacker's landwalk keyword (CR 702.13). The block-restrictions
 * module's landwalk loop calls this gate before rejecting; on a match
 * the rejection is suppressed and the block is allowed to stand.
 *
 * Both predicates must match: a static targeting only specific blockers
 * (ValidBlocker$ Creature.Black) only opens the gate for those
 * blockers, and likewise an attacker-scoped static only relaxes the
 * landwalk that matches.
 */
export const ignoresLandWalk = (game: Game, blockerId: EntityId, attackerId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("IgnoreLandwalk");
  for (const s of statics) {
    const payload = s.describe() as IgnoreLandWalkPayload;
    if (!payload.blockerMatches(blockerId, game)) continue;
    if (!payload.attackerMatches(attackerId, game)) continue;
    return true;
  }
  return false;
};

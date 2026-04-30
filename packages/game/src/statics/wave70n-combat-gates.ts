// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.N — query helper for the AssignNoCombatDamage static mode:
//   - assignsNoCombatDamage  → attackerPower (combat damage assignment)
//
// Walks the staticEffectRegistry by mode and returns a single boolean
// the consumer site uses to short-circuit combat-damage assignment.
//
// Read-side consumers:
//   - assignsNoCombatDamage  → combat/damage-assignment-helpers.ts
//                               (attackerPower returns 0 on match,
//                                taking precedence over the
//                                CombatDamageToughness substitution)
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D-M. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth.
import type { EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AssignNoCombatDamagePayload } from "../static/handlers/assign-no-combat-damage-static.js";

/**
 * True iff `cardId` assigns 0 combat damage because some active
 * AssignNoCombatDamage static matches it (CR 510.1d / Forge's
 * StaticAbilityAssignNoCombatDamage). On match, attackerPower returns
 * 0 regardless of the card's power or any CombatDamageToughness
 * substitution.
 */
export const assignsNoCombatDamage = (game: Game, attackerId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("AssignNoCombatDamage");
  for (const s of statics) {
    const payload = s.describe() as AssignNoCombatDamagePayload;
    if (payload.cardMatches(attackerId, game)) return true;
  }
  return false;
};

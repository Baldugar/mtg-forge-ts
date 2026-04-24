// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.49 — Ninjutsu. Activated ability playable during the declare-
// blockers step: return an unblocked attacker to its owner's hand; then
// put a creature with ninjutsu from your hand onto the battlefield
// tapped and attacking. The new creature is considered to have been
// declared as an attacker this combat (CR 509 does not re-run; the
// swap preserves the combat-state attacker slot).
//
// SP2 scope: expose the state-mutation primitive. Full activated-ability
// wiring (mana cost, commander-cost restrictions, responder window)
// arrives in SP3 with the full activated-ability pipeline.
import type { EntityId } from "@mtg-forge-ts/core";
import type { CombatHandler } from "../combat-handler.js";

/**
 * Swap an unblocked attacker for a new attacker from hand. Throws if
 * the attacker isn't present in the combat state, or if it's already
 * blocked — ninjutsu requires the outgoing attacker be unblocked.
 *
 * Side effects (SP2 minimal):
 *   - CombatState.attackers: remove old, insert new with same defender.
 *   - CombatState.blockerOrdering: clear any stale entry keyed by the
 *     outgoing attacker (safety; the empty check above should mean there
 *     is none).
 *
 * Zone movement (old → owner's hand; new → battlefield tapped) is NOT
 * performed here. SP3 wires that through GameAction.moveTo + tap in the
 * activated-ability resolution path; SP2 exposes only the CombatState
 * mutation because the rest of the machinery is scheduled for SP3.
 */
export const ninjutsuSwap = (
  handler: CombatHandler,
  unblockedAttackerId: EntityId,
  newAttackerFromHandId: EntityId,
): void => {
  const state = handler.state;
  const info = state.attackers.get(unblockedAttackerId);
  if (!info) {
    throw new Error(`ninjutsuSwap: attacker ${unblockedAttackerId} not declared`);
  }
  const blockers = state.blockerOrdering.get(unblockedAttackerId);
  if (blockers !== undefined && blockers.length > 0) {
    throw new Error(`ninjutsuSwap: attacker ${unblockedAttackerId} is blocked`);
  }
  state.attackers.delete(unblockedAttackerId);
  state.attackers.set(newAttackerFromHandId, {
    attackerId: newAttackerFromHandId,
    defender: info.defender,
    isTapped: false,
  });
  state.blockerOrdering.delete(unblockedAttackerId);
};

// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.17c / 702.19 / 702.2 — damage assignment validation for a blocked
// attacker against an ordered list of blockers.
//
// Rules enforced:
//   * CR 702.17c (lethal-before-spill): the attacker's controller chooses
//     how to divide damage, but each blocker must be assigned lethal damage
//     before the NEXT blocker in the damage assignment order (or the
//     defender, via trample) may receive any.
//   * CR 702.19b (trample): damage in excess of what's needed to assign
//     lethal to every blocker may be assigned to the defender.
//   * CR 702.2b (deathtouch): any nonzero damage from a deathtouch source
//     is lethal for the purpose of assignment (so "minimum lethal" is 1).
//
// `validateAssignment` returns a boolean; `defaultAssignment` produces a
// concrete assignment that passes validation. CombatHandler.dealDamage
// falls back to `defaultAssignment` when the controller has not declared
// one via the chooseCombatAssignment decision (SP3).
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { DefenderTarget } from "./combat-state.js";
import { creatureToughness, hasKeyword } from "./damage-assignment-helpers.js";

export interface CombatDamageAssignment {
  readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
  readonly targetId: EntityId | PlayerSeat;
  readonly amount: number;
}

/**
 * Minimum damage that must be assigned to a blocker before the NEXT
 * blocker or defender may receive any. Deathtouch collapses this to 1
 * (CR 702.2b). Pre-existing damage marked on the blocker reduces the
 * threshold: a creature with 2 damage marked and toughness 3 needs only
 * 1 more to be considered lethal-assigned.
 */
export const minimumLethalTo = (game: Game, attackerId: EntityId, blockerId: EntityId): number => {
  if (hasKeyword(game, attackerId, "deathtouch")) return 1;
  const toughness = creatureToughness(game, blockerId);
  const card = game.cards.get(blockerId);
  const damageMarked = card?.damage ?? 0;
  // At least 1 — a 0-toughness blocker that somehow exists still needs
  // some damage before the next in line can be assigned. Matches Forge.
  return Math.max(1, toughness - damageMarked);
};

/**
 * Encode a damage target as a stable map key so a proposed assignment can
 * be collapsed to a per-target total. First-letter prefixes are unique
 * across the four target kinds: c(reature), p(layer), w (plane[s]walker —
 * avoids clashing with "p"), b(attle).
 */
const targetKey = (
  kind: "creature" | "player" | "planeswalker" | "battle",
  id: EntityId | PlayerSeat,
): string => {
  switch (kind) {
    case "creature":
      return `c:${String(id)}`;
    case "player":
      return `p:${String(id)}`;
    case "planeswalker":
      return `w:${String(id)}`;
    case "battle":
      return `b:${String(id)}`;
    default: {
      const _never: never = kind;
      throw new Error(`targetKey: unreachable ${String(_never)}`);
    }
  }
};

const defenderKeyFor = (d: DefenderTarget): string => {
  switch (d.kind) {
    case "player":
      return targetKey("player", d.seat);
    case "planeswalker":
      return targetKey("planeswalker", d.id);
    case "battle":
      return targetKey("battle", d.id);
    default: {
      const _never: never = d;
      throw new Error(`defenderKeyFor: unreachable ${JSON.stringify(_never)}`);
    }
  }
};

/**
 * Validate a proposed assignment. Returns true iff:
 *   1. sum(amounts) === power (all damage is assigned);
 *   2. every amount is a non-negative integer;
 *   3. without trample, no damage may be assigned to the defender;
 *   4. for each blocker index i, cumulative damage to blockers[0..i] is
 *      at least min(cumulative-lethal[0..i], power).
 *
 * When `power <= 0` the only valid assignment is the empty one.
 */
export const validateAssignment = (
  game: Game,
  attackerId: EntityId,
  orderedBlockers: readonly EntityId[],
  power: number,
  defender: DefenderTarget,
  proposed: readonly CombatDamageAssignment[],
): boolean => {
  if (power <= 0) return proposed.length === 0;
  let totalAssigned = 0;
  const byTarget = new Map<string, number>();
  for (const a of proposed) {
    if (a.amount < 0 || !Number.isInteger(a.amount)) return false;
    const key = targetKey(a.targetKind, a.targetId);
    byTarget.set(key, (byTarget.get(key) ?? 0) + a.amount);
    totalAssigned += a.amount;
  }
  if (totalAssigned !== power) return false;

  const trample = hasKeyword(game, attackerId, "trample");
  const defKey = defenderKeyFor(defender);
  const defenderAmount = byTarget.get(defKey) ?? 0;
  if (!trample && defenderAmount > 0) return false;

  let cumAssignedToBlockers = 0;
  let cumLethal = 0;
  for (const blockerId of orderedBlockers) {
    cumLethal += minimumLethalTo(game, attackerId, blockerId);
    const key = targetKey("creature", blockerId);
    cumAssignedToBlockers += byTarget.get(key) ?? 0;
    // Lethal-before-spill: earlier blockers must have received their
    // share. With trample, the min(cumLethal, power) floor is naturally
    // satisfied when the attacker has assigned lethal across all blockers
    // and then spills to defender — the cumAssignedToBlockers total
    // covers cumLethal at each prefix.
    if (cumAssignedToBlockers < Math.min(cumLethal, power)) {
      return false;
    }
  }
  return true;
};

/**
 * Produce a legal assignment: minimum lethal to each blocker in order,
 * then overage to defender (with trample) or onto the last blocker
 * (without). Dumping excess on the last blocker after lethal has been
 * satisfied to all preceding blockers is always legal per CR 702.17c.
 */
export const defaultAssignment = (
  game: Game,
  attackerId: EntityId,
  orderedBlockers: readonly EntityId[],
  power: number,
  defender: DefenderTarget,
): readonly CombatDamageAssignment[] => {
  if (power <= 0) return [];
  const out: CombatDamageAssignment[] = [];
  let remaining = power;
  for (const blockerId of orderedBlockers) {
    if (remaining <= 0) break;
    const lethal = minimumLethalTo(game, attackerId, blockerId);
    const assign = Math.min(remaining, lethal);
    out.push({ targetKind: "creature", targetId: blockerId, amount: assign });
    remaining -= assign;
  }
  if (remaining > 0) {
    if (hasKeyword(game, attackerId, "trample")) {
      out.push(defenderAssignment(defender, remaining));
    } else {
      // Non-trample overage: dump onto the last blocker. Validator accepts
      // this — the lethal-before-spill rule is already satisfied and the
      // total assigned to blockers equals power (no defender spill).
      const lastIdx = out.length - 1;
      if (lastIdx >= 0) {
        const last = out[lastIdx];
        if (last !== undefined) {
          out[lastIdx] = { ...last, amount: last.amount + remaining };
        }
      }
      // If there were no blockers at all, `out` is empty — the caller
      // (CombatHandler.dealDamage) handles the unblocked path separately
      // and never invokes defaultAssignment in that branch, so this case
      // is unreachable in production paths.
    }
  }
  return out;
};

const defenderAssignment = (defender: DefenderTarget, amount: number): CombatDamageAssignment => {
  switch (defender.kind) {
    case "player":
      return { targetKind: "player", targetId: defender.seat, amount };
    case "planeswalker":
      return { targetKind: "planeswalker", targetId: defender.id, amount };
    case "battle":
      return { targetKind: "battle", targetId: defender.id, amount };
    default: {
      const _never: never = defender;
      throw new Error(`defenderAssignment: unreachable ${JSON.stringify(_never)}`);
    }
  }
};

/**
 * CR 702.22 — Banding validation for a blocker that's blocking MULTIPLE
 * attackers. A single banding blocker may divide its damage across every
 * attacker it's blocking (CR 702.22h). Without banding, a blocker can
 * only legally block one attacker in the first place; a multi-attacker
 * block without banding is an illegal block declaration (callers surface
 * this upstream — this validator assumes the block legality check has
 * already accepted the declaration).
 *
 * Returns true iff:
 *   - single attacker: the proposed assignment is exactly one entry with
 *     all `power` to that attacker (no partial withholding allowed for a
 *     non-banding multi-block).
 *   - multiple attackers: blocker has banding; every proposed-assignment
 *     attacker is in the declared attacker list; amounts are non-negative
 *     integers summing to power. Unlike attacker-side validation, there
 *     is NO lethal-before-spill ordering constraint for a banding
 *     blocker — the blocker's controller distributes freely.
 */
export const validateBlockerDamageDistribution = (
  game: Game,
  blockerId: EntityId,
  attackerIds: readonly EntityId[],
  power: number,
  proposed: readonly { readonly attackerId: EntityId; readonly amount: number }[],
): boolean => {
  if (power <= 0) return proposed.length === 0;
  if (attackerIds.length <= 1) {
    if (proposed.length !== 1) return false;
    if (proposed[0]?.attackerId !== attackerIds[0]) return false;
    if (proposed[0]?.amount !== power) return false;
    return true;
  }
  // Multiple attackers → blocker must have banding.
  if (!hasKeyword(game, blockerId, "banding")) return false;
  const attackerSet = new Set(attackerIds);
  let total = 0;
  for (const p of proposed) {
    if (!Number.isInteger(p.amount) || p.amount < 0) return false;
    if (!attackerSet.has(p.attackerId)) return false;
    total += p.amount;
  }
  return total === power;
};

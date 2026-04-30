// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.H — query helpers for the three Wave-70.H static modes:
//   - OptionalAttackCost  → collectOptionalAttackCosts
//   - AttackRestrict      → exceedsAttackerCap
//   - BlockRestrict       → exceedsBlockerCap
//
// Each helper walks the staticEffectRegistry by mode and returns the
// matched gate answer that the consumer site uses at the matching
// decision point.
//
// Read-side consumers:
//   - collectOptionalAttackCosts → SP3 attack-declaration UI; offered as
//                                   an optional cost the controller may
//                                   pay as the matched creature attacks.
//                                   MVP returns the metadata; full cost
//                                   payment integration is the follow-up
//                                   (// TODO(advanced) on the static).
//   - exceedsAttackerCap         → CombatHandler.declareAttackers; counts
//                                   declared attackers (overall, or
//                                   filtered by ValidDefender$) and
//                                   returns true on overflow → caller
//                                   throws IllegalDecisionError.
//   - exceedsBlockerCap          → CombatHandler.declareBlockers; counts
//                                   declared blockers and returns true on
//                                   overflow.
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// the Wave 60.A / 70.D / 70.E / 70.F / 70.G pattern. The static
// registry already snapshots and restores cleanly, so walking the
// registry per-query is the right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AttackRestrictPayload } from "../static/handlers/attack-restrict-static.js";
import type { BlockRestrictPayload } from "../static/handlers/block-restrict-static.js";
import type { OptionalAttackCostPayload } from "../static/handlers/optional-attack-cost-static.js";
import type { Restriction } from "./cant-must-may.js";

/**
 * Defender-target shape mirroring CombatState.DefenderTarget; kept local
 * to avoid a circular import. Used by exceedsAttackerCap to scope the
 * cap's ValidDefender$ filter against each declared defender.
 */
export type DefenderForCap =
  | { readonly kind: "player"; readonly seat: PlayerSeat }
  | { readonly kind: "planeswalker"; readonly id: EntityId }
  | { readonly kind: "battle"; readonly id: EntityId };

/**
 * Optional-attack-cost entries collected for a given attacker. Each
 * entry surfaces the cost text + Trigger$ SVar key + description of one
 * matching static. SP3 attack-declaration UI iterates the entries and
 * lets the controller opt in per-static (multiple optional costs may
 * apply simultaneously — Forge corpus has stacking Exert + secondary
 * static shapes).
 */
export interface OptionalAttackCostEntry {
  readonly costText: string | undefined;
  readonly triggerSVar: string | undefined;
  readonly description: string | undefined;
  readonly sourceStaticId: EntityId;
}

/**
 * Walk the registry for OptionalAttackCost statics matching `attackerId`
 * and return the per-entry metadata. Empty array → no optional costs
 * apply (the canonical case for vanilla creatures; Exert lives only on
 * the ~28 cards in the corpus).
 */
export const collectOptionalAttackCosts = (
  game: Game,
  attackerId: EntityId,
): readonly OptionalAttackCostEntry[] => {
  const out: OptionalAttackCostEntry[] = [];
  const statics = game.staticEffectRegistry.byMode("OptionalAttackCost");
  for (const s of statics) {
    const r = s.describe() as Restriction;
    const payload = r.payload as OptionalAttackCostPayload | undefined;
    if (payload === undefined || payload.kind !== "optionalAttackCostExtended") continue;
    if (!payload.cardMatches(attackerId, game)) continue;
    out.push({
      costText: payload.costText,
      triggerSVar: payload.triggerSVar,
      description: payload.description,
      sourceStaticId: r.sourceStaticId,
    });
  }
  return out;
};

/**
 * Per-attacker info passed to exceedsAttackerCap. The combat-handler
 * supplies one entry per declared attacker so the cap can scope its
 * ValidDefender$ filter against the per-attacker defender.
 */
export interface DeclaredAttackerForCap {
  readonly attackerId: EntityId;
  readonly defender: DefenderForCap;
}

/**
 * True iff the declared attacker set violates any active AttackRestrict
 * cap. The check counts attackers per static — for a static with no
 * ValidDefender$ filter, the count is the total declared; for a static
 * with a defender filter, only attackers declared against a matching
 * defender count toward the cap.
 *
 * Returns the FIRST violated cap's payload + count for caller error
 * messaging (mirror of validateBlockDeclarations' single-illegal
 * return shape — the decision-point validator surfaces "AttackRestrict
 * 1 / declared 2" in the IllegalDecisionError reason).
 */
export const exceedsAttackerCap = (
  game: Game,
  declared: readonly DeclaredAttackerForCap[],
): { readonly payload: AttackRestrictPayload; readonly count: number } | null => {
  const statics = game.staticEffectRegistry.byMode("AttackRestrict");
  if (statics.length === 0) return null;
  for (const s of statics) {
    const payload = s.describe() as AttackRestrictPayload;
    if (payload.kind !== "attackRestrict") continue;
    let count = 0;
    for (const d of declared) {
      if (payload.hasDefenderFilter) {
        if (d.defender.kind === "player") {
          if (!payload.defenderSeatMatches(d.defender.seat)) continue;
        } else {
          if (!payload.defenderCardMatches(d.defender.id, game)) continue;
        }
      }
      count++;
    }
    if (count > payload.maxAttackers) return { payload, count };
  }
  return null;
};

/**
 * Per-blocker info passed to exceedsBlockerCap. The blocker may be
 * declared against multiple attackers (band-style) — each (blocker,
 * attacker) pair counts independently against the cap, mirroring CR
 * 509.1g; the combat-handler caller flattens its declarations before
 * passing them in.
 */
export interface DeclaredBlockerForCap {
  readonly blockerId: EntityId;
  /** The attacker this blocker is declared against. */
  readonly attackerId: EntityId;
  /** The defender of the matched attacker (player or planeswalker). */
  readonly defender: DefenderForCap;
}

/**
 * True iff the declared blocker set violates any active BlockRestrict
 * cap. Same shape as exceedsAttackerCap. The MVP counts each declared
 * blocker entry once per matching cap; the per-defender-allotment form
 * (Mirri "each opponent can't block with more than one") is // TODO.
 */
export const exceedsBlockerCap = (
  game: Game,
  declared: readonly DeclaredBlockerForCap[],
): { readonly payload: BlockRestrictPayload; readonly count: number } | null => {
  const statics = game.staticEffectRegistry.byMode("BlockRestrict");
  if (statics.length === 0) return null;
  for (const s of statics) {
    const payload = s.describe() as BlockRestrictPayload;
    if (payload.kind !== "blockRestrict") continue;
    let count = 0;
    for (const d of declared) {
      if (payload.hasDefenderFilter) {
        if (d.defender.kind === "player") {
          if (!payload.defenderSeatMatches(d.defender.seat)) continue;
        } else {
          if (!payload.defenderCardMatches(d.defender.id, game)) continue;
        }
      }
      count++;
    }
    if (count > payload.maxBlockers) return { payload, count };
  }
  return null;
};

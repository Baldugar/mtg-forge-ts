// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.L — query helpers for the three Wave-70.L static modes:
//   - CantPayLife                → cantPayLife
//   - MustTarget                 → mustTargetCandidates
//   - ActivateAbilityAsIfHaste   → canActivateAsIfHaste
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value (boolean / candidate set) the consumer site uses to
// override the canonical behavior at the matching decision point.
//
// Read-side consumers:
//   - cantPayLife              → cost-payment site (cost-pay-life.canPay
//                                  / activate / cast pipeline) — when
//                                  any matching gate is active for the
//                                  payer + cause, life-payment is
//                                  rejected.
//   - mustTargetCandidates     → target-validation site (cast / activate
//                                  pipelines) — when at least one
//                                  candidate exists AND can be legally
//                                  targeted, the chooser MUST include
//                                  one in the target set.
//   - canActivateAsIfHaste     → activate-ability summoning-sickness
//                                  pre-check — suppresses the
//                                  sickness rejection on a match.
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D-K. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { ActivateAbilityAsIfHastePayload } from "../static/handlers/activate-ability-as-if-haste-static.js";
import type { CantPayLifePayload, PayLifeCause } from "../static/handlers/cant-pay-life-static.js";
import type { MustTargetPayload, MustTargetSA } from "../static/handlers/must-target-static.js";

/**
 * True iff any active CantPayLife static rejects life-payment for the
 * given (payer, cause) tuple. False (canonical default) iff no matching
 * gate is in force.
 *
 * Forge equivalent: `StaticAbilityCantPayLife.cantPayLife(...)` returning
 * a non-null gating static.
 */
export const cantPayLife = (game: Game, payerSeat: PlayerSeat, cause: PayLifeCause): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPayLife");
  for (const s of statics) {
    const payload = s.describe() as CantPayLifePayload;
    if (!payload || payload.kind !== "cantPayLife") continue;
    if (!payload.forCost) continue;
    if (!payload.playerMatches(payerSeat)) continue;
    if (!payload.causeMatches(cause)) continue;
    return true;
  }
  return false;
};

/**
 * Return the set of card ids in the required zone that any active
 * MustTarget gate names as "must include if able" for the given SA.
 *
 * - Returns an empty array when no MustTarget gate matches the SA OR
 *   when no candidate cards exist in the required zone.
 * - The validator at validateAtCast time MUST verify that, when this
 *   set is non-empty AND the SA can legally target at least one of
 *   them with at least one of its target slots, the chosen targets
 *   include at least one element of this set.
 *
 * Multiple MustTarget statics MAY apply simultaneously; the result is
 * the UNION of each gate's candidate set (any of them satisfies the
 * "at least one" requirement, since each gate is independent).
 */
export const mustTargetCandidates = (game: Game, sa: MustTargetSA): readonly EntityId[] => {
  const statics = game.staticEffectRegistry.byMode("MustTarget");
  if (statics.length === 0) return [];

  const candidates = new Set<EntityId>();
  for (const s of statics) {
    const payload = s.describe() as MustTargetPayload;
    if (!payload || payload.kind !== "mustTarget") continue;
    if (!payload.saMatches(sa)) continue;

    // Walk the required zone for matching candidate cards.
    for (const card of game.cards.values()) {
      if (card.zone !== payload.validZone) continue;
      if (!payload.targetMatches(card.id, game)) continue;
      candidates.add(card.id);
    }
  }
  return [...candidates];
};

/**
 * True iff any active ActivateAbilityAsIfHaste static permits the
 * matched card to bypass summoning sickness for the activated-ability
 * tap-cost gate. False (canonical default) iff no matching static is
 * in force.
 *
 * Forge equivalent: walks the StaticAbilityMode.ActivateAbilityAsIfHaste
 * registry; the activate-ability validator consults this BEFORE
 * applying the sickness rejection.
 */
export const canActivateAsIfHaste = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("ActivateAbilityAsIfHaste");
  for (const s of statics) {
    const payload = s.describe() as ActivateAbilityAsIfHastePayload;
    if (!payload || payload.kind !== "activateAbilityAsIfHaste") continue;
    if (payload.cardMatches(cardId, game)) return true;
  }
  return false;
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.I — query helpers for the three Wave-70.I static modes:
//   - CantDraw            → canDraw
//   - NumLoyaltyAct       → effectiveMaxLoyaltyActivations
//   - NoCleanupDamage     → clearsDamageInCleanup
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value (boolean / integer) the consumer site uses to override
// the canonical rules behavior at the matching decision point.
//
// Read-side consumers:
//   - canDraw                          → GameAction.drawCards
//                                         (per-card draw loop bails
//                                          silently when matched seat
//                                          is gated; CR 121.5)
//   - effectiveMaxLoyaltyActivations   → activate-time gate on loyalty
//                                         abilities (CR 606.5b cap +
//                                         per-static delta; activator
//                                         rejects when count >= cap)
//   - clearsDamageInCleanup            → phase-handler cleanup step
//                                         (CR 514.2 marked-damage clear;
//                                          gate suppresses the clear for
//                                          matched creatures)
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E / 70.F. The static registry already
// snapshots and restores cleanly, so walking the registry per-query is
// the right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantDrawPayload } from "../static/handlers/cant-draw-static.js";
import type { NoCleanupDamagePayload } from "../static/handlers/no-cleanup-damage-static.js";
import type { NumLoyaltyActPayload } from "../static/handlers/num-loyalty-act-static.js";

/**
 * True iff `seat` may draw cards (CR 121.1). False iff any active
 * CantDraw static matches the seat. Consumed by GameAction.drawCards
 * per-card loop — on a match the per-card draw is skipped silently
 * (no CardDrawn event, no library scan, no cardsDrawnThisTurn
 * increment). Per CR 121.5, "if an effect causes a player to draw 0
 * cards, no cards are drawn".
 */
export const canDraw = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantDraw");
  for (const s of statics) {
    const payload = s.describe() as CantDrawPayload;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

/**
 * Effective per-turn cap on a planeswalker's loyalty-ability activations
 * (CR 606.5b). Default is 1 (the canonical "no more than one of a
 * planeswalker's loyalty abilities can be activated each turn" cap).
 * Each active NumLoyaltyAct static matching the planeswalker contributes
 * its NumActivations$ delta; the effective cap is `1 + sum_of_deltas`.
 *
 * Consumed by the activate-time gate on loyalty abilities: the activator
 * compares `loyaltyActivationsThisTurn(card) < effectiveCap` and rejects
 * the activation (no cost paid, no stack push) when at the cap.
 */
export const effectiveMaxLoyaltyActivations = (game: Game, planeswalkerId: EntityId): number => {
  let total = 1;
  const statics = game.staticEffectRegistry.byMode("NumLoyaltyAct");
  for (const s of statics) {
    const payload = s.describe() as NumLoyaltyActPayload;
    if (payload.cardMatches(planeswalkerId, game)) {
      total += payload.numActivations;
    }
  }
  return total;
};

/**
 * True iff `cardId`'s marked damage should clear during the cleanup
 * step (CR 514.2 — "all damage marked on creatures is removed"). False
 * iff any active NoCleanupDamage static matches the card; in that case
 * the damage stays past cleanup and accumulates across turns until
 * cleared by another effect.
 *
 * Consumed by phase-handler at the Cleanup step's marked-damage clear
 * pass: each creature with marked damage is gated through this helper
 * before its `card.damage` is reset to 0.
 */
export const clearsDamageInCleanup = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("NoCleanupDamage");
  for (const s of statics) {
    const payload = s.describe() as NoCleanupDamagePayload;
    if (payload.cardMatches(cardId, game)) return false;
  }
  return true;
};

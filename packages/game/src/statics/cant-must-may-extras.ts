// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — additional gather helpers for static modes that don't fit the
// classic single-restriction sweep:
//
//   - canBlockBeRejected: walks every CantBlockBy + CantBlock restriction
//     and returns true iff the (attacker, blocker) pair is rejected.
//   - canAttackerBypassDefender: walks every CanAttackDefender restriction
//     and returns true iff the attacker is allowed to attack despite the
//     defender keyword.
//   - shouldGrantFlash: walks every CastWithFlash static (mode-indexed,
//     ruleChanging category) and returns true iff the spell is flash-able.
//   - gatherPanharmoniconHits: walks every Panharmonicon static (ruleChanging)
//     and returns the matching payloads for a given (sourceCardId,
//     eventKind) tuple.
//   - gatherAlternativeCosts: walks every AlternativeCost static (alternativeCost
//     category) for a given card. Cast-pipeline reads this during
//     stepChooseAltCosts (when wired in a follow-up wave).
//
// Each helper is read-only and side-effect-free; SP3 wiring sites consult
// these before mutating game state.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { AlternativeCostPayload } from "../static/handlers/alternative-cost.js";
import type { PanharmoniconPayload } from "../static/handlers/panharmonicon.js";
import type { Restriction } from "./cant-must-may.js";
import { gatherRestrictions } from "./cant-must-may.js";

/**
 * True iff at least one CantBlock restriction matches the blocker, OR at
 * least one CantBlockBy restriction matches the (attacker, blocker) pair.
 */
export const isBlockingRestricted = (game: Game, attackerId: EntityId, blockerId: EntityId): boolean => {
  // Single-subject CantBlock — the existing kind already exists.
  for (const r of gatherRestrictions(game, "cantBlock")) {
    if (r.subjectFilter(blockerId, game)) return true;
  }
  // Two-subject CantBlockBy — both filters must match.
  for (const r of gatherRestrictions(game, "cantBlockBy")) {
    if (!r.subjectFilter(attackerId, game)) continue;
    if (r.auxFilter && !r.auxFilter(blockerId, game)) continue;
    return true;
  }
  return false;
};

/**
 * True iff at least one CanAttackDefender restriction matches the
 * attacker. Combat-handler attack-legality calls this BEFORE rejecting
 * an attack on the basis of the defender keyword.
 */
export const canAttackerBypassDefender = (game: Game, attackerId: EntityId): boolean => {
  for (const r of gatherRestrictions(game, "canAttackDefender")) {
    if (r.subjectFilter(attackerId, game)) return true;
  }
  return false;
};

/**
 * True iff at least one CastWithFlash static (registered under
 * `ruleChanging`) matches the spell + caster. Walks byMode rather than
 * byCategory because the canonical category map sends CastWithFlash to
 * the same bucket as Panharmonicon and many other rule-overrides.
 */
export const shouldGrantFlash = (game: Game, cardId: EntityId, casterSeat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CastWithFlash");
  for (const s of statics) {
    const payload = s.describe() as Restriction;
    if (!payload.subjectFilter(cardId, game)) continue;
    if (payload.auxFilter && !payload.auxFilter(casterSeat, game)) continue;
    return true;
  }
  return false;
};

/**
 * Walk every Panharmonicon static and return the PanharmoniconPayload
 * entries whose ValidCard$ matches `triggerSourceId` and whose
 * ValidEvent$ matches (or is undefined) `eventKind`. The trigger
 * scheduler totals up `additionalFires` from each match to compute the
 * fire-count multiplier. Wave-50 MVP — readers exist; the consumer is
 * `// TODO(advanced)`.
 */
export const gatherPanharmoniconHits = (
  game: Game,
  triggerSourceId: EntityId,
  eventKind: string,
): readonly PanharmoniconPayload[] => {
  const statics = game.staticEffectRegistry.byMode("Panharmonicon");
  const out: PanharmoniconPayload[] = [];
  for (const s of statics) {
    const payload = s.describe() as PanharmoniconPayload;
    if (!payload.cardMatches(triggerSourceId, game)) continue;
    if (payload.validEventKind !== undefined && payload.validEventKind !== eventKind) continue;
    out.push(payload);
  }
  return out;
};

/**
 * Walk every AlternativeCost static (alternativeCost category) and return
 * the entries whose ValidCard$ matches `cardId` and whose Activator$
 * matches `casterSeat`. Cast-pipeline consumes the result in
 * stepChooseAltCosts (wired in a follow-up wave).
 */
export const gatherAlternativeCosts = (
  game: Game,
  cardId: EntityId,
  casterSeat: PlayerSeat,
): readonly AlternativeCostPayload[] => {
  const statics = game.staticEffectRegistry.byCategory("alternativeCost");
  const out: AlternativeCostPayload[] = [];
  for (const s of statics) {
    const payload = s.describe() as AlternativeCostPayload;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.seatMatches(casterSeat)) continue;
    out.push(payload);
  }
  return out;
};

/**
 * Walk every OptionalCost static (cantMustMay category, kind ===
 * "optionalCost") and return the matching restrictions. The cast pipeline
 * consumes these in stepChooseAltCosts as additional optional cost
 * options.
 */
export const gatherOptionalCosts = (
  game: Game,
  cardId: EntityId,
  casterSeat: PlayerSeat,
): readonly Restriction[] => {
  const out: Restriction[] = [];
  for (const r of gatherRestrictions(game, "optionalCost")) {
    if (!r.subjectFilter(cardId, game)) continue;
    if (r.auxFilter && !r.auxFilter(casterSeat, game)) continue;
    // Re-check via OptionalCostPayload's seatMatches (carried in payload).
    const payload = r.payload as { readonly seatMatches?: (s: PlayerSeat) => boolean } | undefined;
    if (payload?.seatMatches !== undefined && !payload.seatMatches(casterSeat)) continue;
    out.push(r);
  }
  return out;
};

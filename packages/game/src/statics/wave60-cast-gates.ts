// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.C — query helpers for the two Wave-60.C "permission gate"
// statics: MayBeCastBy, MaxLevel. Each helper walks the
// staticEffectRegistry by mode and returns either a boolean (the
// cast pipeline asks "may this player cast this card?") or a number
// (the level-up SA asks "what is this card's MaxLevel cap?").
//
// Read-side consumers:
//   - mayBeCastBy   → cast pipeline / legal-action enumerator
//                     (positively grants permission past hand-only / zone
//                     restrictions when a MayBeCastBy static matches).
//   - maxLevelOf   → Class keyword's synthesized level-up SA
//                     (refuses to fire when classLevel >= classMaxLevel).
//
// Why standalone helpers (mirrors wave60-cant-gates.ts): GameFlags is a
// serializable struct; methods on it would not survive snapshot/restore
// without bespoke wiring. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth — and matches the pattern Wave 60.A established with
// canPutCounter / canBeRegenerated / canUntap.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { MaxLevelPayload } from "../static/handlers/max-level-static.js";
import type { MayBeCastByPayload } from "../static/handlers/may-be-cast-by-static.js";

/**
 * True iff some active MayBeCastBy static positively grants `casterSeat`
 * permission to cast `cardId`. Walks every MayBeCastBy entry in the
 * registry; a match (cardMatches AND casterMatches) grants permission.
 *
 * The cast pipeline / legal-action enumerator consults this in addition
 * to the standard zone+timing checks: when this returns true, the cast
 * is permitted regardless of zone-source / hand-only restrictions
 * (Bolas's Citadel / Oracle of Mul Daya / Sen Triplets / Wishclaw
 * Talisman / Knowledge Pool / Mind's Dilation).
 *
 * Returns false on no-match — callers should treat false as "no
 * positive permission grant; fall back to the standard cast-rules
 * gate" (NOT as a denial).
 */
export const mayBeCastBy = (game: Game, cardId: EntityId, casterSeat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("MayBeCastBy");
  for (const s of statics) {
    const payload = s.describe() as MayBeCastByPayload;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.casterMatches(casterSeat)) continue;
    return true;
  }
  return false;
};

/**
 * Returns the MaxLevel cap for `cardId`, or undefined if no MaxLevel
 * static targets it. Walks the registry; if multiple MaxLevel statics
 * target the same card (unusual — Forge typically stamps Card.Self
 * once), returns the minimum cap (most restrictive wins).
 *
 * The Class keyword's level-up SA gate reads either this helper or
 * `card.classMaxLevel` directly — both agree because the static
 * stamps the slot on activate. The helper exists so future readers
 * (e.g. UI tooltips) can resolve the cap without a card lookup.
 */
export const maxLevelOf = (game: Game, cardId: EntityId): number | undefined => {
  const statics = game.staticEffectRegistry.byMode("MaxLevel");
  let best: number | undefined;
  for (const s of statics) {
    if (s.sourceCardId !== cardId) continue;
    const payload = s.describe() as MaxLevelPayload;
    if (payload.maxLevel <= 0) continue;
    if (best === undefined || payload.maxLevel < best) best = payload.maxLevel;
  }
  return best;
};

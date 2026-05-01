// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 78 — query helpers for the three Wave-78 static modes:
//   - BlockTapped  → canBlockWhileTapped(blockerId)
//   - FlipCoinMod  → flipCoinModifier(seat)
//   - Devotion     → devotionModifierFor(seat, color)
//
// Each helper walks the staticEffectRegistry by mode and returns the
// value the consumer site uses to override the canonical behavior at
// the matching decision point.
//
// Read-side consumers:
//   - canBlockWhileTapped → combat/keywords/block-restrictions.ts (the
//                            tapped-rejection at block validation; bypass
//                            when a matching BlockTapped static is in
//                            force).
//   - flipCoinModifier    → ability/effects/flip-a-coin.ts (the
//                            coin-flip resolver — consult the modifier
//                            before generating a random outcome and
//                            override the result accordingly).
//   - devotionModifierFor → svar/selectors/wave42-selectors.ts (the
//                            Count$Devotion.<Color> selector — final
//                            total = symbol-counter + Wave-78 modifier).
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// the established Wave 60.A / 70.D-N / 76 / 77 pattern. The static
// registry already snapshots and restores cleanly, so walking the
// registry per-query is the right source of truth.
import type { Color, EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { BlockTappedPayload } from "../static/handlers/block-tapped-static.js";
import type { DevotionPayload } from "../static/handlers/devotion-static.js";
import type { FlipCoinForcedResult, FlipCoinModPayload } from "../static/handlers/flip-coin-mod-static.js";

/**
 * True iff some active BlockTapped static permits `blockerId` to block
 * while tapped (Forge's "block as though untapped" semantics, CR 509.1a
 * carve-out). The block-restrictions module's tapped-rejection consults
 * this gate before rejecting; on a match the rejection is suppressed
 * and the block is allowed to stand even if `card.tapped === true`.
 *
 * Forge equivalent: `StaticAbilityBlockTapped.canBlockWhileTapped`.
 */
export const canBlockWhileTapped = (game: Game, blockerId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("BlockTapped");
  for (const s of statics) {
    const payload = s.describe() as BlockTappedPayload;
    if (!payload || payload.kind !== "blockTapped") continue;
    if (payload.cardMatches(blockerId, game)) return true;
  }
  return false;
};

export interface FlipCoinModifierResult {
  /**
   * "default" when no static is in force; "forced-heads" / "forced-tails"
   * when an active static dictates the outcome; "double-flip-pick" when a
   * Krark's-Thumb-shape modifier grants the controller-preferred result
   * out of 2 random draws; "reflip-on-loss" (Wave 101) when a Krark's-
   * Other-Thumb-shape modifier re-flips losing outcomes (the second
   * outcome stands).
   */
  readonly mode: "default" | "forced-heads" | "forced-tails" | "double-flip-pick" | "reflip-on-loss";
}

const RESULT_TO_MODE: Readonly<Record<FlipCoinForcedResult, "forced-heads" | "forced-tails">> = {
  heads: "forced-heads",
  tails: "forced-tails",
};

/**
 * Returns the active flip-coin modifier for `seat`. Default is the
 * canonical CR 705 random outcome; an active matching FlipCoinMod
 * static overrides it (Edgar / Krark's Thumb shape).
 *
 * Precedence: the first matching forced-result static wins; if none
 * forces a result but at least one grants doubleFlip, the result is
 * "double-flip-pick".
 *
 * Forge equivalent: `StaticAbilityFlipCoinMod.modifier(player)`.
 */
export const flipCoinModifier = (game: Game, seat: PlayerSeat): FlipCoinModifierResult => {
  const statics = game.staticEffectRegistry.byMode("FlipCoinMod");
  let doubleFlip = false;
  let reflip = false;
  for (const s of statics) {
    const payload = s.describe() as FlipCoinModPayload;
    if (!payload || payload.kind !== "flipCoinMod") continue;
    if (!payload.playerMatches(seat)) continue;
    if (payload.forcedResult !== undefined) {
      return { mode: RESULT_TO_MODE[payload.forcedResult] };
    }
    if (payload.doubleFlip) doubleFlip = true;
    if (payload.reflip) reflip = true;
  }
  // Precedence: doubleFlip (controller-pick from 2) is strictly stronger
  // than reflip-on-loss (re-roll a single loss); when both are granted,
  // doubleFlip wins. Forge mirrors this — Krark's Thumb's
  // controller-pick supersedes reflip if both are in force on the same
  // controller.
  if (doubleFlip) return { mode: "double-flip-pick" };
  if (reflip) return { mode: "reflip-on-loss" };
  return { mode: "default" };
};

/**
 * Returns the additive Devotion modifier applied to `seat`'s devotion
 * to `color` (CR 700.5). 0 (the canonical default) iff no matching
 * static is in force; otherwise the sum of:
 *   - per-player Amount$ values (Altar of the Pantheon — adds to ALL
 *                                colors regardless of `color`);
 *   - per-card DevotionMod$ values for cards on the battlefield matching
 *     the static's ValidCard$ filter, when the static's DevotionColor$
 *     matches `color` (or is unset, meaning "any color").
 *
 * Consumed by the Wave 42 `countDevotionTo` selector: the runtime
 * total = canonical_symbol_count + devotionModifierFor(seat, color).
 *
 * Forge equivalent: `StaticAbilityDevotion.modifier(player, color)`.
 */
export const devotionModifierFor = (game: Game, seat: PlayerSeat, color: Color): number => {
  let total = 0;
  const statics = game.staticEffectRegistry.byMode("Devotion");
  for (const s of statics) {
    const payload = s.describe() as DevotionPayload;
    if (!payload || payload.kind !== "devotion") continue;
    if (payload.hasPlayerScope) {
      // Per-player additive (Altar shape: adds to every color).
      if (payload.playerMatches(seat)) total += payload.playerAmount;
      continue;
    }
    if (payload.hasCardScope) {
      // Per-card additive: only when the queried color matches the
      // static's DevotionColor$ filter (or it's unset).
      if (payload.devotionColor !== undefined && payload.devotionColor !== color) continue;
      // Walk the battlefield: every card matching the filter under
      // `seat`'s control contributes cardMod once.
      for (const [cid, card] of game.cards) {
        if (card.controllerSeat !== seat) continue;
        if (payload.cardMatches(cid, game)) total += payload.cardMod;
      }
    }
  }
  return total;
};

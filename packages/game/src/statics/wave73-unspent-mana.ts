// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 73 — query helpers for the UnspentMana / ManaBurn static modes.
// Mirrors Forge's `forge.game.staticability.StaticAbilityUnspentMana`
// (`getManaToKeep` + `hasManaBurn`).
//
// Read-side consumers:
//   - PhaseHandler emptyManaPools step (CR 106.4) consults
//     `retainsUnspentMana(game, seat)` to decide whether a player's
//     mana pool should be drained at the end of each phase.
//   - For partial retention (Omnath: only Green retained), the
//     consumer iterates the pool and only drops shards whose color
//     fails `shardSurvivesEmpty`.
//   - `playerHasManaBurn(game, seat)` is consulted right after the
//     drop step to determine whether to deal 1 life-loss per shard
//     just removed.
import type { Color } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { ManaBurnPayload } from "../static/handlers/mana-burn-static.js";
import type { UnspentManaPayload } from "../static/handlers/unspent-mana-static.js";

/**
 * Walk the registry. Returns true when ANY active UnspentMana static
 * matches `seat` AND retains EVERY color (no ManaType$ filter — the
 * Upwelling shape). When this is true the caller can short-circuit
 * the entire empty step for that seat.
 *
 * Note: per-color retention is a different question — even when this
 * returns false, the seat may still retain SOME colors via
 * `shardSurvivesEmpty`. The two functions compose: the caller can
 * use this as a fast path for full-retention, then fall back to the
 * per-shard filter for partial-retention shapes.
 */
export const retainsUnspentMana = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("UnspentMana");
  for (const s of statics) {
    const payload = s.describe() as UnspentManaPayload | undefined;
    if (!payload || payload.kind !== "unspentMana") continue;
    if (!payload.playerMatches(seat)) continue;
    if (payload.retainsAll) return true;
  }
  return false;
};

/**
 * Per-shard predicate: true when a mana shard of the given color
 * should be retained at the end-of-phase empty step for the given
 * seat. Combines ALL active UnspentMana statics matching the seat
 * (any one match is enough — Forge's getManaToKeep returns a Set of
 * "colors to keep").
 *
 * `null` represents a colorless shard. No card in the current corpus
 * uses ManaType$ Colorless; the colorless path therefore returns true
 * only when an Upwelling-shape (no ManaType$) static is active.
 */
export const shardSurvivesEmpty = (game: Game, seat: PlayerSeat, color: Color | null): boolean => {
  const statics = game.staticEffectRegistry.byMode("UnspentMana");
  for (const s of statics) {
    const payload = s.describe() as UnspentManaPayload | undefined;
    if (!payload || payload.kind !== "unspentMana") continue;
    if (!payload.playerMatches(seat)) continue;
    if (payload.retainsAll) return true;
    if (payload.retainsColor(color)) return true;
  }
  return false;
};

/**
 * Returns true when the matched seat suffers mana-burn (CR pre-2009
 * R 119.10): each unspent shard removed from the pool deals 1 life
 * loss. Routes through both the per-game GameRules.manaBurn flag
 * (retro / Limited modes) AND the per-seat ManaBurn static (Yurlok).
 *
 * Forge mirrors this layering: `ManaPool.hasBurn` returns
 * `getRules().hasManaBurn() || StaticAbilityUnspentMana.hasManaBurn(p)`.
 */
export const playerHasManaBurn = (game: Game, seat: PlayerSeat): boolean => {
  if (game.rules.manaBurn) return true;
  const statics = game.staticEffectRegistry.byMode("ManaBurn");
  for (const s of statics) {
    const payload = s.describe() as ManaBurnPayload | undefined;
    if (!payload || payload.kind !== "manaBurn") continue;
    if (payload.playerMatches(seat)) return true;
  }
  return false;
};

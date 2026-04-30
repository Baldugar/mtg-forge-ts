// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 72 — query helper for the TapPowerValue static mode (Forge's
// `forge.game.staticability.StaticAbilityTapPowerValue`).
//
// The Crew (CR 702.121), Saddle (CR 702.165), and Station (CR 718)
// activated abilities each sum the "tap power value" of the creatures
// the controller chooses to tap as part of resolving their effect. The
// static can override this contribution per creature:
//   - Value$ Toughness  → use the creature's toughness instead of power
//                          (Forge: `withToughness` returns true).
//   - Value$ N          → add N to the creature's power
//                          (Forge: `getMod` accumulates ints).
//
// Multiple TapPowerValue statics may match the same creature + activation
// context simultaneously: per Forge's `withToughness` short-circuits the
// modifier sum (if any matching static says "use toughness", we use
// toughness — the integer modifiers are ignored). The integer modifiers
// stack additively otherwise.
//
// Read-side consumers:
//   - crewSumPower / saddleSumPower / stationSumPower (in
//     ability/effects/{crew,saddle,station}.ts) consult
//     effectiveTapPowerValue per candidate creature when summing
//     against the activation threshold.
import type { EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type {
  TapPowerValuePayload,
  TapPowerValueSaContext,
} from "../static/handlers/tap-power-value-static.js";

/**
 * Result of consulting all active TapPowerValue statics for a single
 * (creature, activation) pair. The contract:
 *   - useToughness=true  → caller substitutes the creature's toughness
 *                          for power; the `mod` field is ignored.
 *   - useToughness=false → caller uses (printed power) + `mod`.
 *
 * Returns `null` when no static matches; caller falls back to the
 * creature's printed/effective power.
 */
export interface TapPowerValueResult {
  readonly useToughness: boolean;
  readonly mod: number;
}

/**
 * Walk the registry and aggregate every active TapPowerValue static
 * matching `cardId` + `saCtx`. Returns null when none match — the
 * caller then uses the creature's effective power as-is.
 *
 * Aggregation rules (parity with Forge):
 *   - any matching static with useToughness=true → result.useToughness=true,
 *     result.mod=0 (the integer modifiers are ignored on the toughness path).
 *   - else → mod is the sum of all matching statics' integer Value$ N.
 */
export const effectiveTapPowerValue = (
  game: Game,
  cardId: EntityId,
  saCtx: TapPowerValueSaContext,
): TapPowerValueResult | null => {
  const statics = game.staticEffectRegistry.byMode("TapPowerValue");
  let useToughness = false;
  let mod = 0;
  let anyMatch = false;
  for (const s of statics) {
    const payload = s.describe() as TapPowerValuePayload;
    if (!payload || payload.kind !== "tapPowerValue") continue;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.saMatches(saCtx, game)) continue;
    anyMatch = true;
    if (payload.useToughness) {
      useToughness = true;
      // Don't break: we may match additional statics, but they're
      // either also useToughness (idempotent) or integer mods (which
      // we discard on the toughness path). Continue to keep the
      // walk cheap & predictable.
    } else {
      mod += payload.mod;
    }
  }
  if (!anyMatch) return null;
  if (useToughness) return { useToughness: true, mod: 0 };
  return { useToughness: false, mod };
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.O — query helpers for the three Wave-70.O static modes:
//   - CantPhaseIn       → canPhaseIn   (consumed by phaseIn primitive)
//   - CantPhaseOut      → canPhaseOut  (consumed by phaseOut primitive)
//   - CantChangeLife    → canChangeLife (consumed by changeLife,
//                                          stronger than CantGainLife +
//                                          CantLoseLife combined)
//
// Each helper walks the staticEffectRegistry by mode and returns a
// boolean the consumer site uses to override the canonical behavior at
// the matching decision point.
//
// Read-side consumers:
//   - canPhaseIn       → phasing-ops.phaseIn — when the matched static
//                          rejects, the transition no-ops silently
//                          (no PhasedIn event).
//   - canPhaseOut      → phasing-ops.phaseOut — symmetric to canPhaseIn.
//   - canChangeLife    → GameAction.changeLife (any non-zero delta) —
//                          when matched, the delta is rewritten to 0
//                          BEFORE the LifeChanged event is emitted, so
//                          downstream observers (Soul's Attendant /
//                          Bloodgift Demon damage-trigger feedbacks) do
//                          not observe a gain or loss.
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D-N. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantChangeLifePayload } from "../static/handlers/cant-change-life-static.js";
import type { CantPhaseInPayload } from "../static/handlers/cant-phase-in-static.js";
import type { CantPhaseOutPayload } from "../static/handlers/cant-phase-out-static.js";

/**
 * True iff `cardId` may phase in (CR 702.26d). False iff any active
 * CantPhaseIn static matches the card. Consumed by `phaseIn` in
 * phasing-ops; on rejection the transition no-ops silently — the card
 * stays phased out, no PhasedIn event is emitted.
 *
 * Forge equivalent: `StaticAbilityCantPhaseIn.cantPhaseIn(card)`.
 */
export const canPhaseIn = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPhaseIn");
  for (const s of statics) {
    const payload = s.describe() as CantPhaseInPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.cardMatches(cardId, game)) return false;
  }
  return true;
};

/**
 * True iff `cardId` may phase out (CR 702.26d). False iff any active
 * CantPhaseOut static matches the card. Consumed by `phaseOut` in
 * phasing-ops; on rejection the transition no-ops silently — the card
 * stays phased in, no PhasedOut event is emitted.
 *
 * Forge equivalent: `StaticAbilityCantPhaseOut.cantPhaseOut(card)`.
 */
export const canPhaseOut = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPhaseOut");
  for (const s of statics) {
    const payload = s.describe() as CantPhaseOutPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.cardMatches(cardId, game)) return false;
  }
  return true;
};

/**
 * True iff `seat`'s life total may change (CR 119). False iff any
 * active CantChangeLife static matches the seat. Consumed by
 * GameAction.changeLife on any non-zero delta — on a match the delta
 * is rewritten to 0 BEFORE the LifeChanged event is emitted, so
 * downstream observers (Soul's Attendant / Bloodgift Demon) do not
 * observe a gain or loss. Stronger than CantGainLife + CantLoseLife
 * combined: a single gate that blocks BOTH directions.
 *
 * Damage-induced life loss (CR 119.3) routes through changeLife and
 * is therefore covered by the same gate. Forge equivalent:
 * `StaticAbilityCantChangeLife.cantChangeLife(player)`.
 */
export const canChangeLife = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantChangeLife");
  for (const s of statics) {
    const payload = s.describe() as CantChangeLifePayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

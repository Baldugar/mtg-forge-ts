// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60 — query helpers for the three Wave-60 "cant" gate statics:
// CantPutCounter, CantRegenerate, DontUntap. Each helper walks the
// staticEffectRegistry by mode/category and returns a single boolean
// the consumer site uses to short-circuit a state mutation.
//
// Read-side consumers:
//   - canPutCounter      → game-action.addCounter (early-return; no event)
//   - canBeRegenerated   → ability/effects/regenerate.ts (skip shield grant)
//   - canUntap           → phase/phase-handler untap loop (skip the untap)
//
// Why standalone helpers (not methods on Game / Game.flags): GameFlags is
// a serializable struct; methods on it would not survive snapshot/restore
// without bespoke wiring. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth — and matches the pattern Wave 50 established with
// cant-must-may-extras.ts.
import type { CounterType, EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantPutCounterPayload } from "../static/handlers/cant-put-counter-static.js";
import type { CantRegeneratePayload } from "../static/handlers/cant-regenerate-static.js";
import { isRestricted } from "./cant-must-may.js";

/**
 * True iff a counter of `counterType` may be added to `cardId`. False iff
 * any active CantPutCounter static matches both the card and the counter
 * type (or matches the card with `CounterType$ Any`).
 */
export const canPutCounter = (game: Game, cardId: EntityId, counterType: CounterType): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPutCounter");
  for (const s of statics) {
    const payload = s.describe() as CantPutCounterPayload;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.counterMatches(counterType)) continue;
    return false;
  }
  return true;
};

/**
 * True iff a regeneration shield may be granted to `cardId`. False iff
 * any active CantRegenerate static matches the card.
 */
export const canBeRegenerated = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantRegenerate");
  for (const s of statics) {
    const payload = s.describe() as CantRegeneratePayload;
    if (!payload.cardMatches(cardId, game)) continue;
    return false;
  }
  return true;
};

/**
 * True iff `cardId` may untap during the active player's untap step.
 * False iff any active DontUntap static (registered as a `cantUntap`
 * Restriction in the cantMustMay bucket) matches the card.
 */
export const canUntap = (game: Game, cardId: EntityId): boolean => {
  return !isRestricted(game, "cantUntap", cardId);
};

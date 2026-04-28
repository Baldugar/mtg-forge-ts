// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.D + 60.G — query helpers for the turn-structure modifier
// statics. Each helper walks the staticEffectRegistry by mode and returns
// either a number cap, a boolean skip-gate, or a counter consumption.
//
// Read-side consumers:
//   - effectiveMaxHandSize             → cleanup-step discard logic
//   - consumePendingAdditionalCombat   → phase-handler end-of-combat hook
//   - shouldSkipUntap (60.G)           → phase-handler untap-step entry
//   - shouldSkipDraw  (60.G)           → phase-handler draw-step entry
//   - consumePendingAdditionalUntap (60.G) → phase-handler untap loop tail
//
// Why standalone helpers (mirrors wave60-cant-gates.ts and wave60-cast-
// gates.ts): GameFlags is a serializable struct; methods on it would not
// survive snapshot/restore cleanly. The static registry already
// snapshots and restores cleanly, so walking the registry per-query is
// the right source of truth.
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { LimitOnHandSizePayload } from "../static/handlers/limit-on-hand-size-static.js";
import type { SkipDrawPayload } from "../static/handlers/skip-draw-static.js";
import type { SkipUntapPayload } from "../static/handlers/skip-untap-static.js";

const DEFAULT_MAX_HAND_SIZE = 7;

/**
 * Returns the effective maximum hand size for `seat` at the cleanup
 * step (CR 402.2). Walks every active LimitOnHandSize static; if any
 * matches the seat, returns that static's amount. When multiple
 * matching statics are active, the LOWEST cap wins (most restrictive).
 * "Unlimited" returns Number.POSITIVE_INFINITY — the cleanup-step
 * discard logic compares hand.size > effectiveMaxHandSize() and never
 * discards when the right-hand side is +Infinity.
 *
 * Default (no matching static): 7. Caller should use Number.isFinite()
 * before applying the discard count, since Unlimited returns Infinity.
 */
export const effectiveMaxHandSize = (game: Game, seat: PlayerSeat): number => {
  const statics = game.staticEffectRegistry.byMode("LimitOnHandSize");
  let best: number | undefined;
  for (const s of statics) {
    const payload = s.describe() as LimitOnHandSizePayload;
    if (!payload.playerMatches(seat)) continue;
    // TODO(advanced) — `isAdditive` (+N / -N modifiers) skipped at MVP;
    // most Forge cards use Unlimited / literal values. Treat additive
    // forms as if literal (the parseAmount in the handler already
    // collapsed them to their integer value).
    if (best === undefined || payload.amount < best) best = payload.amount;
  }
  return best ?? DEFAULT_MAX_HAND_SIZE;
};

/**
 * Returns true and decrements the pending counter if `seat` has at
 * least one pending additional combat phase queued. False otherwise
 * (no decrement). Called by the phase handler at the end of the current
 * combat block — when this returns true, the phase handler injects the
 * extra combat steps via PhaseSequence.injectExtraCombat.
 */
export const consumePendingAdditionalCombat = (game: Game, seat: PlayerSeat): boolean => {
  const cur = game.flags.pendingAdditionalCombatPhases.get(seat) ?? 0;
  if (cur <= 0) return false;
  if (cur === 1) {
    game.flags.pendingAdditionalCombatPhases.delete(seat);
  } else {
    game.flags.pendingAdditionalCombatPhases.set(seat, cur - 1);
  }
  return true;
};

/**
 * Returns the current pending-additional-combat-phase count for `seat`
 * without decrementing. Useful for UI / introspection.
 */
export const pendingAdditionalCombatCount = (game: Game, seat: PlayerSeat): number => {
  return game.flags.pendingAdditionalCombatPhases.get(seat) ?? 0;
};

// ─── Wave 60.G — SkipUntap / SkipDraw / AdditionalUntapStep gates ─────────

/**
 * True iff `seat` should skip the untap step entirely (CR 502.1). Walks
 * every active SkipUntap static; on the first match the entire untap-
 * step turn-based action is suppressed (no untap-all loop, no phasing
 * processing, no DontUntap consultation — the step shell still emits
 * for replay determinism but its body is a no-op).
 */
export const shouldSkipUntap = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("SkipUntap");
  for (const s of statics) {
    const payload = s.describe() as SkipUntapPayload;
    if (payload.playerMatches(seat)) return true;
  }
  return false;
};

/**
 * True iff `seat` should skip the draw step entirely (CR 504.1). Walks
 * every active SkipDraw static; on the first match the draw turn-based
 * action is suppressed (no card drawn). The step shell still emits.
 */
export const shouldSkipDraw = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("SkipDraw");
  for (const s of statics) {
    const payload = s.describe() as SkipDrawPayload;
    if (payload.playerMatches(seat)) return true;
  }
  return false;
};

/**
 * Returns true and decrements the pending counter if `seat` has at least
 * one pending additional untap step queued. False otherwise (no
 * decrement). Called by the phase handler at the END of the canonical
 * untap-step turn-based actions; while this returns true the handler
 * runs the untap-all loop again. CR 502 (Awakening Zone / Time Vault).
 */
export const consumePendingAdditionalUntap = (game: Game, seat: PlayerSeat): boolean => {
  const cur = game.flags.pendingAdditionalUntapSteps.get(seat) ?? 0;
  if (cur <= 0) return false;
  if (cur === 1) {
    game.flags.pendingAdditionalUntapSteps.delete(seat);
  } else {
    game.flags.pendingAdditionalUntapSteps.set(seat, cur - 1);
  }
  return true;
};

/**
 * Returns the current pending-additional-untap-step count for `seat`
 * without decrementing. Useful for UI / introspection.
 */
export const pendingAdditionalUntapCount = (game: Game, seat: PlayerSeat): number => {
  return game.flags.pendingAdditionalUntapSteps.get(seat) ?? 0;
};

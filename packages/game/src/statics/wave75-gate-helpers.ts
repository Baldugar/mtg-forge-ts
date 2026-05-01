// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — query helpers for the four Wave-75 static modes:
//   - CanAdapt        → canAdaptAgain
//   - CanExhaust      → canReExhaust
//   - IgnoreShroud    → ignoresShroud
//   - CantExile       → canBeExiled
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single boolean the consumer site uses to override the canonical
// behavior at the matching decision point.
//
// Read-side consumers:
//   - canAdaptAgain   → ability/effects/adapt.ts (CR 702.139a "no
//                         +1/+1 counters" precondition is bypassed
//                         when a CanAdapt static matches the
//                         creature; mirrors Forge's
//                         StaticAbilityAdapt.anyWithAdapt path).
//   - canReExhaust    → forward-compat stub for the not-yet-ported
//                         Exhaust mechanic. Forge's Exhaust grants
//                         "activate each exhaust ability only once"
//                         on a card; CanExhaust grants permission to
//                         re-activate. The static still registers and
//                         the helper is exposed so the future Exhaust
//                         pipeline can read it uniformly.
//                         TODO(advanced).
//   - ignoresShroud   → target/enumeration.ts (analogous to Wave 70.K
//                         IgnoreHexproof bypass — when a static
//                         matches the activator and the would-be
//                         target's shroud is bypassed for that
//                         activator).
//   - canBeExiled     → action/game-action.ts moveTo (destination
//                         Exile gated; matched cards refuse the
//                         exile and the action no-ops silently).
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// Wave 60.A / 60.H / 70.D / 70.E / 70.F / 70.I / 70.J / 70.K / 70.M /
// 70.O / 74. The static registry already snapshots and restores
// cleanly, so walking the registry per-query is the right source of
// truth — and matches the established gate pattern.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CanAdaptPayload } from "../static/handlers/can-adapt-static.js";
import type { CanExhaustPayload } from "../static/handlers/can-exhaust-static.js";
import type { CantExilePayload, ExileCause } from "../static/handlers/cant-exile-static.js";
import type { IgnoreShroudPayload } from "../static/handlers/ignore-shroud-static.js";

/**
 * True iff the creature `cardId` may adapt as though it had no
 * +1/+1 counters on it (CR 702.139a override). False (the canonical
 * default) iff no matching static is in force — AdaptEffect.resolve
 * keeps the standard "no counters" precondition.
 *
 * Forge equivalent: StaticAbilityAdapt.anyWithAdapt(...) returning a
 * non-null gating static.
 */
export const canAdaptAgain = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CanAdapt");
  for (const s of statics) {
    const payload = s.describe() as CanAdaptPayload;
    if (!payload || payload.kind !== "canAdapt") continue;
    if (payload.cardMatches(cardId, game)) return true;
  }
  return false;
};

/**
 * True iff `seat` may activate exhaust abilities again (CR / EOE
 * mechanic). False (the canonical default) iff no matching static is
 * in force.
 *
 * Read-side wiring is TODO(advanced) until Exhaust lands as a
 * keyword + activation gate; the static still registers and the
 * helper is exposed so the future Exhaust pipeline can read it
 * uniformly.
 *
 * Forge equivalent: StaticAbilityExhaust.anyWithExhaust(...).
 */
export const canReExhaust = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CanExhaust");
  for (const s of statics) {
    const payload = s.describe() as CanExhaustPayload;
    if (!payload || payload.kind !== "canExhaust") continue;
    if (!payload.playerMatches(seat)) continue;
    // Wave 101 — PlayerTurn$ filter AND-combined with ValidPlayer$.
    if (!payload.turnMatches(game)) continue;
    return true;
  }
  return false;
};

/**
 * True iff the activator `activatorSeat` (with optional candidate
 * target `targetId`) bypasses shroud per any active IgnoreShroud
 * static. False (the canonical default) iff no matching static is
 * in force.
 *
 * The targetId is optional because some consumers consult the gate
 * before they know the candidate target (e.g. early enumeration).
 * Without a target, the per-static ValidEntity$ filter is treated
 * as "match" (the gate is potentially-active for any target).
 *
 * Forge equivalent: StaticAbilityIgnoreHexproofShroud.ignore(...)
 * with the SHROUD branch.
 */
export const ignoresShroud = (game: Game, activatorSeat: PlayerSeat, targetId?: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("IgnoreShroud");
  for (const s of statics) {
    const payload = s.describe() as IgnoreShroudPayload;
    if (!payload || payload.kind !== "ignoreShroud") continue;
    if (!payload.activatorMatches(activatorSeat)) continue;
    if (targetId !== undefined && !payload.entityMatches(targetId, game)) continue;
    return true;
  }
  return false;
};

/**
 * True iff `cardId` may be exiled (CR 406). False iff any active
 * CantExile static matches the candidate card — the destination is
 * rejected and the moveTo no-ops silently (no zone change, no
 * CardChangedZone event for the Exile transition).
 *
 * Forge equivalent: StaticAbilityCantExile.cantExile(...) returning
 * a non-null gating static.
 */
export const canBeExiled = (game: Game, cardId: EntityId, cause?: ExileCause): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantExile");
  for (const s of statics) {
    const payload = s.describe() as CantExilePayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (!payload.cardMatches(cardId, game)) continue;
    // Wave 110 — ValidCause$ + ForCost$ sub-conditional gate. When a
    // cause is supplied, the static fires only when the cause matches
    // the static's filters (The Master, Multiplied: only your own
    // triggered abilities are blocked; opp-driven exiles still work).
    // When no cause is supplied (legacy callers), the gate falls back
    // to the always-fire shape — matches pre-Wave-110 behavior.
    if (cause !== undefined && payload.causeMatches !== undefined) {
      if (!payload.causeMatches(cause, payload.staticControllerSeat)) continue;
    }
    return false;
  }
  return true;
};

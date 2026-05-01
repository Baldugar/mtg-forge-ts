// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 77 — query helpers for the three Wave-77 static modes:
//   - WitherDamage   → dealsWitherDamage(source)
//   - InfectDamage   → dealsInfectDamage(source)
//   - SurveilNum     → surveilNumModifier(seat)
//
// Each helper walks the staticEffectRegistry by mode and returns the
// value the consumer site uses to override the canonical behavior at
// the matching decision point.
//
// Read-side consumers:
//   - dealsWitherDamage   → action/game-action.ts (damage application;
//                            OR-combined with the K:Wither keyword
//                            check — either path triggers the
//                            -1/-1-counter redirect for damage to
//                            creatures).
//   - dealsInfectDamage   → action/game-action.ts (damage application;
//                            OR-combined with the K:Infect keyword
//                            check — either path triggers BOTH
//                            redirects: -1/-1 counters for creatures,
//                            poison counters for players).
//   - surveilNumModifier  → ability/effects/surveil.ts (the Surveil
//                            effect resolver — runtime count is
//                            baseN + sum of matching modifiers).
//
// Why standalone helpers (not methods on Game / Game.flags): mirrors
// the established Wave 60.A / 70.D-N / 76 pattern. The static registry
// already snapshots and restores cleanly, so walking the registry
// per-query is the right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { InfectDamagePayload } from "../static/handlers/infect-damage-static.js";
import type { SurveilNumPayload } from "../static/handlers/surveil-num-static.js";
import type { WitherDamagePayload } from "../static/handlers/wither-damage-static.js";

/**
 * True iff some active WitherDamage static rewrites `sourceId`'s damage
 * to creatures into -1/-1 counter damage (CR 702.79 Wither — static
 * form). Forge's StaticAbilityWitherDamage.applyWither(...) call site.
 *
 * The keyword path (K:Wither) and the static path are OR-combined
 * upstream: either suffices to trigger the creature-damage redirect.
 */
export const dealsWitherDamage = (game: Game, sourceId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("WitherDamage");
  for (const s of statics) {
    const payload = s.describe() as WitherDamagePayload;
    if (!payload || payload.kind !== "witherDamage") continue;
    if (payload.cardMatches(sourceId, game)) return true;
  }
  return false;
};

/**
 * True iff some active InfectDamage static rewrites `sourceId`'s damage
 * to creatures into -1/-1 counter damage AND its damage to players into
 * poison counters (CR 702.90 Infect — static form). Forge's
 * StaticAbilityInfectDamage.applyInfect(...) call site.
 *
 * The keyword path (K:Infect) and the static path are OR-combined
 * upstream: either suffices to trigger BOTH redirects.
 */
export const dealsInfectDamage = (game: Game, sourceId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("InfectDamage");
  for (const s of statics) {
    const payload = s.describe() as InfectDamagePayload;
    if (!payload || payload.kind !== "infectDamage") continue;
    if (payload.cardMatches(sourceId, game)) return true;
  }
  return false;
};

/**
 * Returns the additive modifier applied to `seat`'s surveil count
 * (CR 701.44 — Surveil). 0 (the canonical default) iff no matching
 * static is in force; otherwise the sum of Amount$ values from all
 * matching SurveilNum statics. Consumed by the Surveil effect
 * resolver: runtime count = baseN + surveilNumModifier(game, seat).
 *
 * Forge equivalent: StaticAbilitySurveilNum.numModifier(player).
 */
export const surveilNumModifier = (game: Game, seat: PlayerSeat): number => {
  let total = 0;
  const statics = game.staticEffectRegistry.byMode("SurveilNum");
  for (const s of statics) {
    const payload = s.describe() as SurveilNumPayload;
    if (!payload || payload.kind !== "surveilNum") continue;
    if (payload.playerMatches(seat)) total += payload.amount;
  }
  return total;
};

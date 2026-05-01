// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.E — query helper for the three Wave-60.E "prevent damage" gate
// statics: PreventAllDamage, PreventAllDamageBy, PreventAllDamageTo.
// Single helper walks all three mode entries in the registry; returns
// true if any active static matches the supplied damage event.
//
// Read-side consumer:
//   - GameAction.damage — early-emit DamagePrevented + bail before the
//     applyWithReplacements/DamageDealt path runs. Mirrors Forge's
//     "silent prevention" semantics: no DamageDealt event is recorded
//     when the gate fires, so downstream observers (life-loss triggers,
//     wither/infect redirects, deathtouch flags, combat-damage-dealt
//     trackers) do not observe damage that was prevented.
//
// Why standalone helper (not a method on Game / Game.flags): GameFlags is
// a serializable struct; methods on it would not survive snapshot/restore
// without bespoke wiring. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth — and matches the pattern Wave 60.A established with
// canPutCounter / canBeRegenerated / canUntap.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantPreventDamagePayload } from "../static/handlers/cant-prevent-damage-static.js";
import type { PreventDamagePayload } from "../static/handlers/prevent-damage-static.js";

const PREVENT_MODES = ["PreventAllDamage", "PreventAllDamageBy", "PreventAllDamageTo"] as const;

/**
 * True iff damage from `sourceId` may be prevented (CR 615.6). False iff
 * any active CantPreventDamage static matches the damage source. Consumed
 * by `wouldPreventDamage` BEFORE the prevention statics are walked — on
 * a match, the prevention loop is short-circuited and damage flows
 * normally. Implements the "X's damage can't be prevented" precedence
 * rule for sources like Comet, Stellar Pup / Inferno / certain Eldrazi.
 *
 * Standalone helper exposure (in addition to its inline use within
 * wouldPreventDamage) lets the AI evaluator and combat-handler pre-flight
 * checks query prevention permissibility without re-walking the registry.
 */
export const canDamageBePrevented = (
  game: Game,
  sourceId: EntityId,
  ctx?: {
    readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
    readonly targetId: EntityId | PlayerSeat;
    readonly isCombat: boolean;
  },
): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPreventDamage");
  for (const s of statics) {
    const payload = s.describe() as CantPreventDamagePayload;
    // Wave 107 — when full event context is available, use the
    // ValidTarget$/Combat$ aware match; otherwise fall back to the
    // legacy source-only probe (preserves the AI evaluator and
    // combat-handler pre-flight call sites).
    if (ctx) {
      if (payload.matchesEvent(sourceId, ctx.targetKind, ctx.targetId, ctx.isCombat, game)) return false;
    } else {
      if (payload.sourceMatches(sourceId, game)) return false;
    }
  }
  return true;
};

/**
 * True iff some active prevent-damage static fully prevents the supplied
 * damage event. Walks every entry in all three Wave-60.E modes; a match
 * by any one entry is enough to short-circuit the damage event.
 *
 * The consumer (GameAction.damage) calls this before constructing the
 * DamageIntent and emits a DamagePrevented event + bails when this
 * returns true. The full prevention semantics here cover the Fog /
 * Holy Day / Worship / Story Circle family; the partial-prevention
 * "prevent up to N damage" Forge variants stay on the existing
 * R:Event$ DamageDone replacement-handler path.
 */
export const wouldPreventDamage = (
  game: Game,
  sourceId: EntityId,
  targetKind: "creature" | "player" | "planeswalker" | "battle",
  targetId: EntityId | PlayerSeat,
  isCombat: boolean,
): boolean => {
  // Wave 70.E — CR 615.6 precedence: if the damage source is gated by an
  // active CantPreventDamage static, the prevention loop is bypassed and
  // damage flows normally. Mirrors Forge's StaticAbilityCantPreventDamage
  // short-circuit at the prevention consultation site.
  // Wave 107 — forward the full event context so the CantPreventDamage
  // ValidTarget$ / Combat$ sub-filters can scope the gate correctly.
  if (!canDamageBePrevented(game, sourceId, { targetKind, targetId, isCombat })) return false;
  for (const mode of PREVENT_MODES) {
    const statics = game.staticEffectRegistry.byMode(mode);
    for (const s of statics) {
      const payload = s.describe() as PreventDamagePayload;
      if (payload.matchesEvent(sourceId, targetKind, targetId, isCombat, game)) {
        return true;
      }
    }
  }
  return false;
};

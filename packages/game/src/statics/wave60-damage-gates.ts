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
import type { PreventDamagePayload } from "../static/handlers/prevent-damage-static.js";

const PREVENT_MODES = ["PreventAllDamage", "PreventAllDamageBy", "PreventAllDamageTo"] as const;

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

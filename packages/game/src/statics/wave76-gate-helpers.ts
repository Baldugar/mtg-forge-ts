// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 76 — query helpers for the four Wave-76 static modes:
//   - CantBeSuspected   → canBeSuspected
//   - CantVenture       → canVenture
//   - PlotZone          → plotZonesFor
//   - GainLifeRadiation → radiationLifeMod
//
// Each helper walks the staticEffectRegistry by mode and returns a
// single value the consumer site (when it lands) will use to override
// the canonical behavior at the matching decision point.
//
// Wave 102 — Suspect IS wired (Wave 71's `ability/effects/suspect.ts`
// and the AlterAttribute lane in `wave-21-effects.ts` consult
// `canBeSuspected` at the application call site, silently
// rejecting matched cards and skipping the CardSuspected event).
// Venture/Dungeon, Plot, and Radiation remain forward-compat
// stubs — the Forge mechanics haven't been ported yet, but the
// helpers register and resolve correctly so static-registry
// snapshots stay consistent and the future mechanic pipelines
// have a uniform read-side hook.
//
// Why standalone helpers (not methods on Game / Game.flags):
// mirrors the established Wave 60 / 70 / 74 / 75 pattern. The
// static registry already snapshots and restores cleanly, so
// walking the registry per-query is the right source of truth.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantBeSuspectedPayload } from "../static/handlers/cant-be-suspected-static.js";
import type { CantVenturePayload } from "../static/handlers/cant-venture-static.js";
import type { GainLifeRadiationPayload } from "../static/handlers/gain-life-radiation-static.js";
import type { PlotZonePayload } from "../static/handlers/plot-zone-static.js";

/**
 * True iff the card `cardId` may be suspected (CR — Suspect mechanic).
 * False iff any active CantBeSuspected static matches the candidate
 * card — the suspect transition is rejected silently.
 *
 * Forward-compat stub: the Suspect mechanic isn't yet wired. The
 * helper resolves correctly today; the future Suspect pipeline
 * will read it at the suspect-application call site.
 *
 * Forge equivalent: StaticAbilityCantBeSuspected.cantSuspect(...).
 */
export const canBeSuspected = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantBeSuspected");
  for (const s of statics) {
    const payload = s.describe() as CantBeSuspectedPayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.cardMatches(cardId, game)) return false;
  }
  return true;
};

/**
 * True iff the player `seat` may venture into the dungeon (CR —
 * Venture mechanic). False iff any active CantVenture static
 * matches the candidate player — the venture is rejected silently.
 *
 * Forward-compat stub: the Venture / Dungeon mechanic isn't yet
 * wired. The helper resolves correctly today; the future Venture
 * pipeline will read it at the venture-resolution call site.
 *
 * Forge equivalent: StaticAbilityCantVenture.cantVenture(...).
 */
export const canVenture = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantVenture");
  for (const s of statics) {
    const payload = s.describe() as CantVenturePayload;
    if (!payload || payload.kind !== "replacementGen") continue;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

/**
 * Returns the set of zones from which `seat` may plot cards (CR —
 * Plot mechanic). The default plot zone is the hand; matching
 * PlotZone statics augment this set with their Zone$ value.
 *
 * Forward-compat stub: the Plot mechanic isn't yet wired. The
 * helper resolves correctly today; the future Plot pipeline will
 * read it at the plot-legality call site.
 *
 * Forge equivalent: StaticAbilityPlotZone.plotZones(player).
 */
export const plotZonesFor = (game: Game, seat: PlayerSeat): ReadonlySet<ZoneType> => {
  const out = new Set<ZoneType>([ZoneType.Hand]);
  const statics = game.staticEffectRegistry.byMode("PlotZone");
  for (const s of statics) {
    const payload = s.describe() as PlotZonePayload;
    if (!payload || payload.kind !== "plotZone") continue;
    if (payload.playerMatches(seat)) out.add(payload.zone);
  }
  return out;
};

/**
 * Returns the per-radiation life-gain modifier for `seat` (CR —
 * Radiation counter mechanic). 0 (the canonical default) iff no
 * matching static is in force; otherwise the sum of Amount$
 * values from all matching statics.
 *
 * Forward-compat stub: the Radiation counter mechanic isn't yet
 * wired. The helper resolves correctly today; the future
 * Radiation pipeline will read it at the radiation counter
 * add/remove call site.
 *
 * Forge equivalent: StaticAbilityGainLifeRadiation.lifeMod(player).
 */
export const radiationLifeMod = (game: Game, seat: PlayerSeat): number => {
  let total = 0;
  const statics = game.staticEffectRegistry.byMode("GainLifeRadiation");
  for (const s of statics) {
    const payload = s.describe() as GainLifeRadiationPayload;
    if (!payload || payload.kind !== "gainLifeRadiation") continue;
    if (payload.playerMatches(seat)) total += payload.amount;
  }
  return total;
};

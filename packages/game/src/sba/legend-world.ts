// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5j/k — legend and world rule SBAs.
//
// Legend rule: two or more legendary permanents with the same name,
// controlled by the same player. That controller chooses one to keep;
// the rest go to their owners' graveyards. We group by
// (controllerSeat, name) and emit one legendRule action per group with
// more than one legendary permanent.
//
// World rule: two or more world-supertype permanents on the battlefield
// (any controller). The most-recently-entered one stays; the rest go to
// their owners' graveyards. We use the EntityId as the timestamp proxy
// because entity ids are allocated monotonically — larger id = more
// recent. When SP3's full layered-timestamp table lands, this heuristic
// can be swapped for a real timestamp lookup.
import { Supertype, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { isPhasedOut } from "../combat/damage-assignment-helpers.js";
import type { Game } from "../game.js";
import { isExemptFromLegendRule } from "../statics/wave70j-rule-gates.js";
import type { SbaAction } from "./sba-action.js";

export const collectLegendWorld = (game: Game, out: SbaAction[]): void => {
  // Legend — bucket legendary permanents by (controllerSeat, name).
  // A nested map: outer = seat, inner = name -> ids.
  const byControllerName = new Map<PlayerSeat, Map<string, EntityId[]>>();
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    // CR 702.26e — phased-out permanents are treated as though they don't
    // exist for most rules, including the legend rule. Audit A-007.
    // Wave 54 — gate via the unified isPhasedOut helper so direct
    // `SP$ Phases` (card.phasedOut) is honoured alongside keyword phasing
    // (card.phased).
    if (isPhasedOut(game, id)) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (!chars.supertypes.has(Supertype.Legendary)) continue;
    // Wave 70.J — IgnoreLegendRule (CR 704.5j override). Mirror Gallery
    // / Sliver Legion / Brothers Yamazaki et al. exempt matched cards
    // from the legend-rule grouping pass. Skip exempt cards entirely so
    // they never contribute to a duplicate-name bucket.
    if (isExemptFromLegendRule(game, id)) continue;
    // Unnamed legendaries (vanishingly rare but valid in test setup) are
    // grouped by empty-string name — still correct per CR (same name,
    // including absent ones, groups together).
    const byName = byControllerName.get(card.controllerSeat) ?? new Map<string, EntityId[]>();
    const list = byName.get(chars.name) ?? [];
    list.push(id);
    byName.set(chars.name, list);
    byControllerName.set(card.controllerSeat, byName);
  }
  for (const [seat, byName] of byControllerName) {
    for (const ids of byName.values()) {
      if (ids.length >= 2) {
        out.push({ kind: "legendRule", controllerSeat: seat, candidateIds: ids });
      }
    }
  }

  // World rule — collect world permanents across the whole battlefield.
  const worldIds: Array<{ id: EntityId; timestamp: number }> = [];
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    // CR 702.26e — phased-out permanents are invisible to the world rule.
    // Wave 54 — uses isPhasedOut to honour both flags.
    if (isPhasedOut(game, id)) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (!chars.supertypes.has(Supertype.World)) continue;
    // EntityId is branded on a number — coerce via unknown. Larger ids
    // are more recent (monotonic allocator); CR 704.5k wants the newest
    // to stay.
    worldIds.push({ id, timestamp: id as unknown as number });
  }
  if (worldIds.length >= 2) {
    const sorted = [...worldIds].sort((a, b) => b.timestamp - a.timestamp);
    const [, ...others] = sorted;
    out.push({ kind: "worldRule", cardIds: others.map((o) => o.id) });
  }
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 47 — Continuous-static `Affected$` filter enumeration.
//
// `Affected$ <filter>` selects the cards a Continuous-mode static targets.
// The filter grammar matches Wave 32's `cardMatchesFilter` (used by
// `ValidCard$/IsPresent$` on triggers): comma-OR alternatives,
// dot/plus-AND qualifiers, base type names, color/subtype probes.
//
// Two enumeration shapes are exposed:
//
//   `enumerateAffectedFromFilter(game, sourceId, controllerSeat, filter)`
//     — returns the live array of EntityIds matching the filter on the
//     battlefield. Re-evaluated by callers on every layer-engine epoch
//     bump (per Wave 32's contract for live conditions).
//
//   `cardIdMatchesAffectedFilter(game, sourceId, controllerSeat, cardId,
//     filter)` — returns true iff the given card id matches the filter.
//     Used by the Continuous-static handler to build a per-card predicate
//     for Layer 4/5/6/7 effects (cheaper than enumerating + .includes()
//     on every layer apply).
//
// Two literal shapes are recognised verbatim before delegating to
// cardMatchesFilter:
//   - `Card.Self`        → only the source card itself.
//   - `Card.EnchantedBy` → the card with attachedTo === sourceId.
// Both are common enough that handling them here lets callers skip the
// filter machinery entirely (and keeps the Bestow / Embalm flagships
// unchanged).
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../../card.js";
import type { Game } from "../../game.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";

const BATTLEFIELD = ZoneType.Battlefield;

/**
 * Wave 100 — parse Forge's `AffectedZone$ <list>` parameter. The grammar
 * is comma-separated zone names (mixed-case as Forge writes them) plus
 * the symbolic literal `All` which expands to "every zone game.cards
 * tracks".
 *
 * Returns:
 *   - `null`   when the parameter is absent or empty (caller should
 *              default to battlefield-only).
 *   - `"all"`  when the parameter is the literal `All` (Painter's
 *              Servant / Conspiracy shape — match every zone).
 *   - a Set    of canonical ZoneType values otherwise. Unknown tokens
 *              are dropped silently so a malformed list collapses to an
 *              empty set (caller treats that as "no zone matches").
 */
export const parseAffectedZones = (raw: string | undefined): ReadonlySet<ZoneType> | "all" | null => {
  if (raw === undefined || raw.length === 0) return null;
  if (raw === "All" || raw === "all") return "all";
  const known = new Set(Object.values(ZoneType) as string[]);
  const result = new Set<ZoneType>();
  for (const tok of raw.split(",").map((s) => s.trim())) {
    if (tok.length === 0) continue;
    if (known.has(tok)) result.add(tok as ZoneType);
  }
  return result;
};

/**
 * True iff `cardId` is the affected target of an `Affected$ <filter>`
 * static whose source is `sourceId` controlled by `controllerSeat`.
 *
 * - `Card.Self`        → cardId === sourceId.
 * - `Card.EnchantedBy` → game.cards.get(sourceId).attachedTo === cardId.
 * - Any other filter   → delegate to Wave 32's cardMatchesFilter on
 *   the resolved Card, gating by the static's `AffectedZone$` parameter
 *   (Wave 100 closure). When `affectedZones` is omitted the caller
 *   keeps the canonical battlefield-only default; pass `"all"` for
 *   Painter's Servant-shape statics that need to reach every zone, or a
 *   Set for explicit lists like `Hand,Battlefield`.
 */
export const cardIdMatchesAffectedFilter = (
  game: Game,
  sourceId: EntityId,
  controllerSeat: PlayerSeat,
  cardId: EntityId,
  filter: string,
  affectedZones?: ReadonlySet<ZoneType> | "all",
): boolean => {
  if (filter === "Card.Self") return cardId === sourceId;
  if (filter === "Card.EnchantedBy") {
    const aura = game.cards.get(sourceId);
    if (!aura) return false;
    return aura.attachedTo === cardId;
  }
  const card = game.cards.get(cardId);
  if (!card) return false;
  // Wave 100 — `AffectedZone$ All` (Painter's Servant / Conspiracy shape)
  // bypasses the battlefield gate; an explicit zone list narrows to those
  // zones; the default (undefined) keeps the canonical Wave 47 contract.
  if (affectedZones === "all") {
    // No zone gate — every zone game.cards tracks is in scope.
  } else if (affectedZones !== undefined) {
    if (!affectedZones.has(card.zone)) return false;
  } else if (card.zone !== BATTLEFIELD) {
    return false;
  }
  return cardMatchesFilter(card, filter, { sourceCardId: sourceId, controllerSeat });
};

/**
 * Live enumeration of every card on the battlefield that matches the
 * given `Affected$ <filter>`. Returns an array (not a Set) for stable
 * ordering across iterations; callers building per-card predicates
 * should prefer `cardIdMatchesAffectedFilter` to avoid the linear scan
 * on every layer apply.
 *
 * `Card.Self` and `Card.EnchantedBy` shortcuts return at most one id
 * each — they're written out so the filter machinery is bypassed for
 * the two existing flagship shapes (Bestow / Embalm), preserving Wave
 * 32 / Wave 33 behavior verbatim.
 */
export const enumerateAffectedFromFilter = (
  game: Game,
  sourceId: EntityId,
  controllerSeat: PlayerSeat,
  filter: string,
  affectedZones?: ReadonlySet<ZoneType> | "all",
): EntityId[] => {
  if (filter === "Card.Self") {
    const src = game.cards.get(sourceId);
    if (!src) return [];
    return [sourceId];
  }
  if (filter === "Card.EnchantedBy") {
    const aura = game.cards.get(sourceId);
    if (!aura || aura.attachedTo === null) return [];
    return [aura.attachedTo];
  }
  const out: EntityId[] = [];
  for (const card of game.cards.values()) {
    // Wave 100 — symmetric zone gating with cardIdMatchesAffectedFilter.
    if (affectedZones === "all") {
      // Every zone in scope.
    } else if (affectedZones !== undefined) {
      if (!affectedZones.has(card.zone)) continue;
    } else if (card.zone !== BATTLEFIELD) {
      continue;
    }
    if (cardMatchesFilter(card as Card, filter, { sourceCardId: sourceId, controllerSeat })) {
      out.push(card.id);
    }
  }
  return out;
};

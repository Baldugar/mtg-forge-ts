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
 * True iff `cardId` is the affected target of an `Affected$ <filter>`
 * static whose source is `sourceId` controlled by `controllerSeat`.
 *
 * - `Card.Self`        → cardId === sourceId.
 * - `Card.EnchantedBy` → game.cards.get(sourceId).attachedTo === cardId.
 * - Any other filter   → delegate to Wave 32's cardMatchesFilter on
 *   the resolved Card, requiring it to be on the battlefield (most
 *   Continuous statics are battlefield-scoped; AffectedZone$ All
 *   widening is currently TODO(advanced)).
 */
export const cardIdMatchesAffectedFilter = (
  game: Game,
  sourceId: EntityId,
  controllerSeat: PlayerSeat,
  cardId: EntityId,
  filter: string,
): boolean => {
  if (filter === "Card.Self") return cardId === sourceId;
  if (filter === "Card.EnchantedBy") {
    const aura = game.cards.get(sourceId);
    if (!aura) return false;
    return aura.attachedTo === cardId;
  }
  const card = game.cards.get(cardId);
  if (!card) return false;
  // Wave 47 MVP — gate on battlefield zone. Continuous statics with
  // `AffectedZone$ All` (Conspiracy / Painter's Servant) reach beyond the
  // battlefield, but the layer-engine cache is only populated for cards
  // accessible via game.cards.get; effects that need to reach hand /
  // graveyard / library cards still apply once those cards are on the
  // battlefield. Off-battlefield-color-add for Painter's Servant is
  // // TODO(advanced) — full multi-zone scoping wires through layer
  // appliers' input zone, which we don't expose today.
  if (card.zone !== BATTLEFIELD) return false;
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
    if (card.zone !== BATTLEFIELD) continue;
    if (cardMatchesFilter(card as Card, filter, { sourceCardId: sourceId, controllerSeat })) {
      out.push(card.id);
    }
  }
  return out;
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Zone-activation discipline for intrinsic card abilities. Every time a
// card changes zone, its intrinsic static abilities (and, in Milestone E
// land, triggered abilities) register or unregister based on the new
// activeInZones membership.
//
// SP2 has no card-definition-derived static abilities yet (SP3 lands the
// DSL + data). For SP2 tests, we use `Card.intrinsicStatics: StaticAbility[]`
// — a slot on the live Card — that test fixtures populate directly.
//
// On register/unregister the LayerEngine epoch is bumped so any layer
// contributors re-evaluate.
import type { EntityId, StaticAbility, ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";
import type { Game } from "../game.js";

export const onZoneChange = (game: Game, cardId: EntityId, from: ZoneType, to: ZoneType): void => {
  const card = game.cards.get(cardId);
  if (!card) return;
  const statics = getIntrinsicStatics(card);
  if (statics.length === 0) return;
  let changed = false;
  for (const s of statics) {
    const wasActive = s.activeInZones.has(from);
    const isActive = s.activeInZones.has(to);
    if (!wasActive && isActive) {
      game.staticEffectRegistry.register(s);
      changed = true;
    } else if (wasActive && !isActive) {
      game.staticEffectRegistry.unregister(s.id);
      changed = true;
    }
  }
  if (changed) game.layerEngine.bumpEpoch("zone-activation");
};

// SP2 exposes `intrinsicStatics` as a runtime slot on Card. SP3 replaces
// this with data-derived population from PaperCard.definition.
export const getIntrinsicStatics = (card: Card): readonly StaticAbility[] => {
  return card.intrinsicStatics ?? [];
};

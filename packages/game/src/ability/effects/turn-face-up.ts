// SPDX-License-Identifier: GPL-3.0-or-later
// TurnFaceUpEffect — resolver for the synthesized Morph / Megamorph /
// Disguise activated abilities (Wave 55, CR 702.36 / 702.94 / 702.166).
//
// CR 702.36b — turning a card face-up is a special action that uses the
// existing flip-up primitive in face-down/turn-face-up.ts. SP3 dispatches
// this as a regular activated SA whose cost is the morph/megamorph/
// disguise mana cost, paid via the SpellAbility cost path. On resolve
// this effect:
//   1. Calls the existing turnFaceUp primitive — clears card.faceDown,
//      bumps the layer engine epoch, emits CardTurnedFaceUp.
//   2. For megamorph (sa.tags has "megamorph"), adds a +1/+1 counter to
//      the source.
//   3. For disguise (sa.tags has "disguise"), the keyword handler's
//      deactivate path will clear the wardCost slot when the keyword is
//      torn down on zone change. While the card is face-up, ward 2 is
//      no longer active — but Wave 49's ward trigger is gated on the
//      face-down state via the keyword being present, not the slot, so
//      additional cleanup here would be belt-and-braces. The slot stays
//      stamped until deactivate is called by the zone-change discipline.
import { CounterType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { turnFaceUp } from "../../face-down/turn-face-up.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class TurnFaceUpEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "TurnFaceUp";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const card = game.cards.get(sa.sourceCardId);
    if (!card) return;
    // Defensive: if the card is somehow not face-down (e.g. duplicate
    // SA activation in a turn) the primitive will throw. Skip the flip
    // when already face-up so the resolver remains idempotent.
    if (card.faceDown.kind === "none") return;

    yield* turnFaceUp(game, sa.sourceCardId);

    // Megamorph: +1/+1 counter post-flip (CR 702.94a).
    if (sa.tags.has("megamorph")) {
      yield* game.action.addCounter(sa.sourceCardId, CounterType.PlusOnePlusOne, 1, sa.sourceCardId);
    }
  }
}

effectRegistry.register(TurnFaceUpEffect);

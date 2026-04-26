// SPDX-License-Identifier: GPL-3.0-or-later
// EmbalmEffect — resolver for the synthesized Embalm activated ability
// (Amonkhet, CR 702.131).
//
// CR 702.131a — "Embalm [cost]" means "[cost], Exile this card from your
// graveyard: Create a token that's a copy of it, except it's a white
// Zombie [original types] with no mana cost. Activate only as a sorcery."
//
// Forge form (CardFactoryUtil.java):
//   AB$ CopyPermanent | Cost$ <costStr> ExileFromGrave<1/CARDNAME>
//   | ActivationZone$ Graveyard | SorcerySpeed$ True
//   | RemoveCost$ True | SetColor$ White | AddTypes$ Zombie
//
// MVP: spawn a token copy via game.action.createToken with isCopy=true and
// stamp the new Card's tokenOverrides slot so deriveBaseCharacteristics
// applies the colour / type / mana-cost overrides on the next layer
// derivation. The exile-self cost is paid by CostExileSelfFromGrave before
// this resolver runs.
import { Color, ColorSet } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class EmbalmEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Embalm";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const ids = yield* game.action.createToken({
      paperCard: source.paperCard,
      controller: sa.controllerSeat,
      count: 1,
      isCopy: true,
      copyOf: sa.sourceCardId,
    });
    for (const id of ids) {
      const tok = game.cards.get(id);
      if (!tok) continue;
      tok.tokenOverrides = {
        colors: ColorSet.of(Color.White),
        addedTypes: ["Zombie"],
        clearManaCost: true,
      };
    }
  }
}

effectRegistry.register(EmbalmEffect);

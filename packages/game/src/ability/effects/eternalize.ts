// SPDX-License-Identifier: GPL-3.0-or-later
// EternalizeEffect — resolver for the synthesized Eternalize activated
// ability (Hour of Devastation, CR 702.139).
//
// CR 702.139a — "Eternalize [cost]" means "[cost], Exile this card from
// your graveyard: Create a token that's a copy of it, except it's a 4/4
// black Zombie [original types] with no mana cost. Activate only as a
// sorcery."
//
// Forge form (CardFactoryUtil.java):
//   AB$ CopyPermanent | Cost$ <costStr> ExileFromGrave<1/CARDNAME>
//   | Defined$ Self | ActivationZone$ Graveyard | SorcerySpeed$ True
//   | RemoveCost$ True | SetColor$ Black | AddTypes$ Zombie
//   | SetPower$ 4 | SetToughness$ 4
//
// MVP: same shape as EmbalmEffect, but with black colour, +Zombie, no mana
// cost, and a 4/4 P/T override. The exile-self cost is paid by
// CostExileSelfFromGrave before this resolver runs.
import { Color, ColorSet } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class EternalizeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Eternalize";

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
        colors: ColorSet.of(Color.Black),
        addedTypes: ["Zombie"],
        clearManaCost: true,
        setPower: 4,
        setToughness: 4,
      };
    }
  }
}

effectRegistry.register(EternalizeEffect);

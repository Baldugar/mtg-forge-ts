// SPDX-License-Identifier: GPL-3.0-or-later
// TransmuteEffect — resolver for the synthesized Transmute activated
// ability (Dissension, CR 702.49). Reads the source card's printed mana
// value, searches the controller's library for a card with the same
// CMC, yields a chooseCard decision over the candidates, moves the
// chosen card to the controller's hand, then shuffles the library.
import type { EntityId, ManaCostAst, PaperCard } from "@mtg-forge-ts/core";
import { ManaCost, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const cardManaValue = (paper: PaperCard | undefined): number => {
  const def = paper?.definition;
  if (!def) return 0;
  const mcAst = def.manaCost as ManaCostAst | null | undefined;
  if (!mcAst) return 0;
  const mc = ManaCost.parse(mcAst.raw);
  return mc.cmc(0);
};

export class TransmuteEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Transmute";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const cmc = cardManaValue(source.paperCard);

    const player = game.getPlayer(sa.controllerSeat);
    const library = player.zones.get(ZoneType.Library);
    if (!library) return;

    const eligible: EntityId[] = [];
    for (const id of library.toArray()) {
      const c = game.cards.get(id);
      if (!c) continue;
      if (cardManaValue(c.paperCard) !== cmc) continue;
      eligible.push(id);
    }

    if (eligible.length > 0) {
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: sa.controllerSeat,
          pool: eligible,
          restriction: { keyword: "transmute", n: cmc },
          min: 0,
          max: 1,
        },
      }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

      const chosenId = decision?.kind === "chooseCard" ? decision.chosen[0] : undefined;
      if (chosenId !== undefined && eligible.includes(chosenId)) {
        yield* game.action.moveTo(chosenId, ZoneType.Hand, {
          toSeat: sa.controllerSeat,
          cause: "transmute",
        });
      }
    }

    // Shuffle the library regardless of whether a card was found.
    yield* game.action.shuffle(sa.controllerSeat);
  }
}

effectRegistry.register(TransmuteEffect);

// SPDX-License-Identifier: GPL-3.0-or-later
// TransfigureEffect — resolver for the synthesized Transfigure activated
// ability (Future Sight, CR 702.74). Reads the source card's printed mana
// value, searches the controller's library for a CREATURE card with the
// same CMC, yields a chooseCard decision over the candidates, puts the
// chosen card onto the battlefield (under the controller), then shuffles
// the library. Mirrors TransmuteEffect's tutor pattern; the difference
// is (a) creature-only filter and (b) destination = Battlefield (not Hand).
//
// CR 702.74a — "Transfigure [cost]" — "[cost], Sacrifice this creature:
// Search your library for a creature card with the same mana value as
// this creature, put it onto the battlefield, then shuffle. Activate only
// as a sorcery."
//
// Note: the activated SA's printed cost is `<cost>, Sac<1/CARDNAME>` so
// the cost-payment pipeline already sacrifices the source. By the time
// this effect resolves the source is in the graveyard; we read its
// PaperCard.definition.manaCost for the CMC reference (the printed
// mana value, mirroring CR 202.3a — derived from the printed mana cost).
import { CardType, type EntityId, type ManaCostAst, type PaperCard } from "@mtg-forge-ts/core";
import { ManaCost, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { canSearchLibrary } from "../../statics/wave60-cant-gates.js";
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

export class TransfigureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Transfigure";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    // CR 701.18 search-prevention static (Mindlock Orb / Stranglehold) —
    // silently skip the search but still shuffle (matches the Transmute
    // pattern; CR 701.18 says the player may not find anything but the
    // tutor's tail effects still resolve).
    if (!canSearchLibrary(game, sa.controllerSeat)) {
      yield* game.action.shuffle(sa.controllerSeat);
      return;
    }
    const cmc = cardManaValue(source.paperCard);

    const player = game.getPlayer(sa.controllerSeat);
    const library = player.zones.get(ZoneType.Library);
    if (!library) return;

    const eligible: EntityId[] = [];
    for (const id of library.toArray()) {
      const c = game.cards.get(id);
      if (!c) continue;
      // Creature-card filter (CR 702.74a). Read off the printed types
      // from the PaperCard.definition rather than computeCharacteristics
      // — cards in the library are not on the battlefield, so layer
      // effects don't apply; the printed type list is the right read.
      const types = c.paperCard.definition?.types?.types;
      if (!types) continue;
      let isCreature = false;
      for (const t of types) {
        if (t === CardType.Creature) {
          isCreature = true;
          break;
        }
      }
      if (!isCreature) continue;
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
          restriction: { keyword: "transfigure", n: cmc },
          min: 0,
          max: 1,
        },
      }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

      const chosenId = decision?.kind === "chooseCard" ? decision.chosen[0] : undefined;
      if (chosenId !== undefined && eligible.includes(chosenId)) {
        // CR 702.74a — put onto the battlefield (under the controller of
        // this transfigure activation; the searcher per CR 701.18b is the
        // controller, who also receives control of the new permanent).
        yield* game.action.moveTo(chosenId, ZoneType.Battlefield, {
          toSeat: sa.controllerSeat,
          cause: "transfigure",
        });
      }
    }

    // Shuffle the library regardless of whether a card was found
    // (CR 701.18b — searching always shuffles).
    yield* game.action.shuffle(sa.controllerSeat);
  }
}

effectRegistry.register(TransfigureEffect);

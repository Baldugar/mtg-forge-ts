// SPDX-License-Identifier: GPL-3.0-or-later
// AmassEffect — Forge `SP$ Amass` (War of the Spark "Amass Orcs N",
// Phyrexia "Amass Zombies N"). Adds N +1/+1 counters to an Army you
// control; if you don't control one, create a 0/0 black <Type> Army
// creature token first, then add the counters.
//
// Forge DSL examples:
//   A:SP$ Amass | Type$ Orc | Num$ X
//   A:SP$ Amass | Type$ Zombie | Num$ X
//   A:SP$ Amass | Type$ Orc | Num$ 2 | RememberAmass$ True | SubAbility$ DBImmediateTrig
//
// MVP scope:
//   - Find an Army the controller controls; if absent, create a 0/0 black
//     <Type> Army creature token first.
//   - Put Num$ +1/+1 counters on the chosen Army.
//   - RememberAmass$ True appends the Army's id to source.remembered.
//
// TODO(advanced): when controller has multiple Armies, Forge prompts for a
// chosen Army; MVP picks the first by iteration order.
import {
  CardType,
  Color,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  TypeLine,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { CardDefinition, EntityId, PaperCard, Supertype } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const synthesizeArmyTokenPaper = (subType: string): PaperCard => {
  const definition: CardDefinition = {
    name: `${subType} Army`,
    oracle: "",
    types: new TypeLine([] as Supertype[], [CardType.Creature], [subType, "Army"]),
    manaCost: null,
    pt: { power: "0", toughness: "0" },
    colors: ColorSet.of(Color.Black),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name: `${subType} Army`,
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

const findControllerArmy = (game: Game, seat: SpellAbility["controllerSeat"]): EntityId | null => {
  for (const [id, card] of game.cards) {
    if (card.controllerSeat !== seat) continue;
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    for (const sub of chars.subtypes) {
      if (sub.toLowerCase() === "army") return id;
    }
  }
  return null;
};

export class AmassEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Amass";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    const subType = hasParam(sa, "Type") ? evaluateParamRaw(sa, "Type") : "Zombie";

    let armyId = findControllerArmy(game, sa.controllerSeat);
    if (armyId === null) {
      // Create a 0/0 black <subType> Army token first.
      const paper = synthesizeArmyTokenPaper(subType);
      const result = yield* game.action.createToken({
        paperCard: paper,
        controller: sa.controllerSeat,
        count: 1,
      });
      // GameAction.createToken returns the created ids; SP3 contract returns
      // void from the generator with side-effects on game.cards. Re-locate
      // the freshest matching Army.
      void result;
      armyId = findControllerArmy(game, sa.controllerSeat);
    }
    if (armyId === null) return;

    yield* game.action.addCounter(armyId, CounterType.PlusOnePlusOne, num, sa.sourceCardId);

    if (hasParam(sa, "RememberAmass") && evaluateParamRaw(sa, "RememberAmass") === "True") {
      const source = game.cards.get(sa.sourceCardId);
      if (source) source.remembered.push(armyId);
    }
  }
}

effectRegistry.register(AmassEffect);

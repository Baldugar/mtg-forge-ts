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
// Wave 80 — when controller has multiple Armies, yield a chooseCard
// decision so the controller picks which Army receives the counters
// (CR 701.45). On invalid responses we fall back to the first by
// iteration order (the prior MVP default).
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

const findControllerArmies = (game: Game, seat: SpellAbility["controllerSeat"]): EntityId[] => {
  const armies: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.controllerSeat !== seat) continue;
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    for (const sub of chars.subtypes) {
      if (sub.toLowerCase() === "army") {
        armies.push(id);
        break;
      }
    }
  }
  return armies;
};

export class AmassEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Amass";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    const subType = hasParam(sa, "Type") ? evaluateParamRaw(sa, "Type") : "Zombie";

    let armies = findControllerArmies(game, sa.controllerSeat);
    if (armies.length === 0) {
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
      armies = findControllerArmies(game, sa.controllerSeat);
    }
    if (armies.length === 0) return;

    // Wave 80 — when controller has multiple Armies, yield chooseCard so
    // controller picks which Army receives the counters (CR 701.45). With a
    // single Army the choice is forced; we still take the head-of-list to
    // keep parity with the prior MVP path.
    let armyId: EntityId | null = armies[0] ?? null;
    if (armies.length > 1) {
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: sa.controllerSeat,
          pool: armies,
          restriction: { effect: "amass", num },
          min: 1,
          max: 1,
        },
      }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
      if (decision && decision.kind === "chooseCard") {
        const eligible = new Set(armies);
        for (const id of decision.chosen) {
          if (eligible.has(id)) {
            armyId = id;
            break;
          }
        }
      }
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

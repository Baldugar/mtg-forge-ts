// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseTypeEffect — ask the controller to choose a creature subtype (or card
// type) and remember the chosen value for downstream effects.
//
// Forge DSL:
//   SP$ ChooseType | RememberChosen$ True | Type$ Creature
//   SP$ ChooseType | RememberChosen$ True | Type$ Creature
//     | TypeDesc$ creature type
//
// Yields a `chooseType` decision request (Wave 4) and stores the result in
// card.chosenTypes[]. Falls back to "Goblin" (common creature subtype used
// in Changeling-adjacent tests) if no decision response is provided.
import type { DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const FALLBACK_TYPE = "Goblin";

export class ChooseTypeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseType";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const typeKind = hasParam(sa, "Type") ? evaluateParamRaw(sa, "Type") : "Creature";

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseType",
        sourceId: sa.sourceCardId,
        typeKind,
      },
    };

    const response = rawResponse as DecisionResponse | undefined;
    let chosen: string;
    if (response && response.kind === "chooseType") {
      chosen = response.type;
    } else {
      // Non-interactive path — default to Goblin.
      chosen = FALLBACK_TYPE;
    }

    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.chosenTypes.push(chosen);
    }
  }
}

effectRegistry.register(ChooseTypeEffect);

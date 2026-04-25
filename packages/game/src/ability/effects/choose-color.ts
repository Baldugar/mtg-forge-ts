// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseColorEffect — ask the controller to pick a color; store the chosen
// color on the source card's `chosenColors` array for later use by other effects.
//
// Forge DSL:
//   SP$ ChooseColor | Defined$ You | RememberChosen$ True
//
// Yields a `chooseColor` decision request (already in core) and stores the
// result in card.chosenColors[]. Falls back to Color.White (0x1) if no
// decision response is supplied (non-interactive/test path).
import type { Color, DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// Numeric enum value matching Color.White (= 1); avoids importing the enum
// at the fallback site but keeps the intent legible.
const FALLBACK_COLOR: Color = 1 as Color;

export class ChooseColorEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseColor";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseColor",
        sourceId: sa.sourceCardId,
        allowColorless: false,
      },
    };

    const response = rawResponse as DecisionResponse | undefined;
    let chosen: Color | null;
    if (response && response.kind === "chooseColor") {
      chosen = response.color;
    } else {
      // Non-interactive path — default to White.
      chosen = FALLBACK_COLOR;
    }

    // Store on the source card's chosenColors slot.
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.chosenColors.push(chosen);
    }
  }
}

effectRegistry.register(ChooseColorEffect);

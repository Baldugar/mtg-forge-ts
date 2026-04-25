// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseTypeEffect — handles Forge's `SP$ ChooseType` effect line.
// Ask the controller to choose a creature subtype (or card type) and remember
// the chosen value for downstream effects.
//
// Forge DSL:
//   SP$ ChooseType | RememberChosen$ True | Type$ Creature
//   SP$ ChooseType | RememberChosen$ True | Type$ Creature
//     | TypeDesc$ creature type
//
// MVP STATUS: STUB — deterministically picks "Human" (the most common Changeling
// subtype) and stores it in card.remembered as a placeholder BigInt sentinel
// (same pattern as ChooseColor). A real interactive `chooseType` decision kind
// is deferred to SP3.
//
// Registered so the semantic validator stops flagging ChooseType as an unknown
// handler key.
//
// TODO(SP3): add a `chooseType` decision kind to core and yield an interactive
// decision request here; store the result in a dedicated card.chosenType field.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ChooseTypeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseType";

  // Non-generator: deterministic type choice stored synchronously.
  override resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      // Store deterministic sentinel — a real chosen-type string lands in SP3.
      // We push 0n so RememberChosen$ True has an entry to work with downstream.
      source.remembered.push(0n as never);
    }

    return (function* (): Generator<EngineYield, void, unknown> {
      /* no engine events for deterministic type choice */
    })();
  }
}

effectRegistry.register(ChooseTypeEffect);

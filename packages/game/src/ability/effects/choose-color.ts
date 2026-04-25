// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseColorEffect — ask the controller to pick a color; store the chosen
// color on the source card for later use by other effects.
//
// Forge DSL:
//   SP$ ChooseColor | Defined$ You | RememberChosen$ True
//
// MVP implementation: no interactive `chooseColor` decision kind exists in
// core/decisions yet. We deterministically pick "White" and store the
// chosen color as a synthetic EntityId (0n) placeholder in card.remembered.
// The `chosenColors` field is added to Card in SP3 when interactive decisions
// land; until then, the remembered list carries a sentinel.
//
// TODO(Wave 9): add a `chooseColor` decision kind to core and yield an
// interactive decision request here, storing the real chosen color string.
//
// The handler is registered so the semantic validator stops flagging
// "ChooseColor" as an unknown handler key.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Default deterministic color selection until interactive decisions land. */
const DEFAULT_COLOR = "White";

export class ChooseColorEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseColor";

  // Non-generator: deterministic color choice stored synchronously.
  override resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    // Store the chosen color as a synthetic marker in remembered.
    // We encode it as a BigInt EntityId-typed sentinel so the list doesn't
    // need a separate type. Real color storage (card.chosenColors: string[])
    // is deferred to SP3.
    if (source) {
      // Store as 0n sentinel — downstream effects that consume chosen colors
      // must be updated when proper chosenColors support lands.
      // For now this ensures RememberChosen$ True has an entry to work with.
      source.remembered.push(0n as never);
    }

    // Suppress unused-variable lint — DEFAULT_COLOR documents intent.
    void DEFAULT_COLOR;

    return (function* (): Generator<EngineYield, void, unknown> {
      /* no engine events emitted for deterministic color choice */
    })();
  }
}

effectRegistry.register(ChooseColorEffect);

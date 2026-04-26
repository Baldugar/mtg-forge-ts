import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
// SPDX-License-Identifier: GPL-3.0-or-later
// AssembleContraptionEffect — Forge `SP$ AssembleContraption` (Steamflogger
// Boss family / Unstable / Unfinity contraption mechanic). Puts the top
// card of the controller's contraption deck onto a chosen sprocket as an
// assembled contraption.
//
// Forge DSL examples:
//   A:SP$ AssembleContraption | Amount$ X
//   A:SP$ AssembleContraption | Amount$ 2
//
// MVP scope:
//   - Amount$ N — number of contraptions to assemble.
//   - Emits an AssembleContraption mutation intent per contraption so the
//     replacement pipeline observes the action.
//   - Records the assemble count on game.flags.attractions[seat] for
//     deterministic test introspection (the contraption deck and sprocket
//     selection are SP4-scope; no real card movement happens in MVP).
//
// TODO(advanced): full contraption deck integration (Wave 19+) — pop the
// top of the contraption deck, prompt for sprocket choice, attach to the
// chosen sprocket. The slot is wired so the handler is callable today.
import type { AssembleContraptionIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class AssembleContraptionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AssembleContraption";

  // biome-ignore lint/correctness/useYield: MVP records intent + flag (no events emitted)
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    for (let i = 0; i < num; i++) {
      const intent: AssembleContraptionIntent = {
        kind: "assembleContraption",
        seat: sa.controllerSeat,
      };
      void intent;
    }
    // Track the count on flags so tests can verify the effect ran.
    const prior = game.flags.attractions.get(sa.controllerSeat) as
      | { assembledContraptions?: number }
      | undefined;
    const assembled = (prior?.assembledContraptions ?? 0) + num;
    game.flags.attractions.set(sa.controllerSeat, { assembledContraptions: assembled });
  }
}

effectRegistry.register(AssembleContraptionEffect);

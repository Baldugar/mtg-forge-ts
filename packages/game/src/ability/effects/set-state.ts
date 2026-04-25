// SPDX-License-Identifier: GPL-3.0-or-later
// SetStateEffect — transforms, flips, or turns face-up a card.
// Primary use: Saga/DFC transform abilities (14 cards in corpus).
//
// Forge DSL:
//   DB$ SetState | Defined$ Self | Mode$ Transform
//   DB$ SetState | Defined$ Self | Mode$ Flip
//   DB$ SetState | Defined$ Self | Mode$ TurnFaceUp
//
// Mode$ Transform — call game.action.transform(cardId) (CR 711 DFC toggle).
// Mode$ Flip      — call game.action.flip(cardId) (CR 709 Kamigawa flip).
// Mode$ TurnFaceUp — call game.action.turnFaceUp(cardId) (CR 702.36 morph/manifest).
//
// Defined$ Self resolves to sa.sourceCardId. Any other value falls back to
// sa.targets for future extensibility (Defined$ Targeted, etc.).
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class SetStateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "SetState";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const mode = hasParam(sa, "Mode") ? evaluateParamRaw(sa, "Mode") : "Transform";
    const defined = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Self";
    const targets = defined === "Self" ? [sa.sourceCardId] : sa.targets;

    if (mode === "Transform") {
      for (const id of targets) {
        yield* game.action.transform(id);
      }
    } else if (mode === "Flip") {
      for (const id of targets) {
        yield* game.action.flip(id);
      }
    } else if (mode === "TurnFaceUp") {
      for (const id of targets) {
        yield* game.action.turnFaceUp(id);
      }
    } else {
      throw new Error(`SetStateEffect: unknown Mode$ '${mode}'`);
    }
  }
}

effectRegistry.register(SetStateEffect);

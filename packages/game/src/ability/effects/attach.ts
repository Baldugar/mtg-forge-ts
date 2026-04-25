// SPDX-License-Identifier: GPL-3.0-or-later
// AttachEffect — attaches the source card (Aura, Equipment, Fortification) to
// the first target via GameAction.attach (CR 303.4f, 301.5b, 302.6).
//
// Forge DSL: SP$ Attach | ValidTgts$ Creature.YouCtrl
//         or DB$ Attach | Defined$ Self  (sa.targets[0] must be pre-populated)
//
// For the MVP we unconditionally attach sa.sourceCardId to sa.targets[0].
// A Defined$ Self case is handled upstream by the resolver placing
// sourceCardId into targets[0]; this effect does not need to distinguish.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class AttachEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Attach";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const targetId = sa.targets[0];
    if (!targetId) return;
    yield* game.action.attach(sa.sourceCardId, targetId, "activated");
  }
}

effectRegistry.register(AttachEffect);

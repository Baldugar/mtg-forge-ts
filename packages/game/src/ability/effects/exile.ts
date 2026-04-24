// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ExileEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Exile";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      yield* game.action.exile(targetId, { sourceId: sa.sourceCardId });
    }
  }
}

effectRegistry.register(ExileEffect);

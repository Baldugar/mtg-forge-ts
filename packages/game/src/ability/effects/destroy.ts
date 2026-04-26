// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineYield } from "../../action/engine-yield.js";
import { parseValidTgts } from "../../cast/valid-targets.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";
import { enumerateOverloadedTargets } from "./overload-enumerate.js";

export class DestroyEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Destroy";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.tags.has("overloaded")) {
      const ids = enumerateOverloadedTargets(sa, game, parseValidTgts);
      for (const targetId of ids) {
        yield* game.action.destroy(targetId, { sourceId: sa.sourceCardId, cause: "effect" });
      }
      return;
    }
    for (const targetId of sa.targets) {
      yield* game.action.destroy(targetId, { sourceId: sa.sourceCardId, cause: "effect" });
    }
  }
}

effectRegistry.register(DestroyEffect);

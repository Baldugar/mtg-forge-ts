// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineYield } from "../../action/engine-yield.js";
import { parseValidTgts } from "../../cast/valid-targets.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";
import { enumerateOverloadedTargets } from "./overload-enumerate.js";

export class DealDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DealDamage";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amount = evaluateParamNumber(sa, "NumDmg", game);
    if (sa.tags.has("overloaded")) {
      const ids = enumerateOverloadedTargets(sa, game, parseValidTgts);
      for (const targetId of ids) {
        // Overload's enumerate-each path is creature-only by design (see
        // overload-enumerate.ts header). Pass kind=creature unconditionally.
        yield* game.action.damage(sa.sourceCardId, "creature", targetId, amount, false);
      }
      return;
    }
    for (const targetId of sa.targets) {
      const asCard = game.cards.get(targetId);
      const targetKind = asCard ? ("creature" as const) : ("player" as const);
      yield* game.action.damage(sa.sourceCardId, targetKind, targetId, amount, false);
    }
  }
}

effectRegistry.register(DealDamageEffect);

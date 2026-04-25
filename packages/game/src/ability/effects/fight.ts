// SPDX-License-Identifier: GPL-3.0-or-later
// FightEffect — two creatures simultaneously deal damage equal to their power
// to each other (CR 701.12). Neither damage assignment is combat damage.
//
// MVP form: sa.targets[0] fights sa.targets[1]. If only one target is
// provided, sa.sourceCardId fights sa.targets[0] (Prey Upon / Savage Punch
// one-target form where the source creature itself is the second fighter).
//
// Forge DSL: SP$ Fight | ValidTgts$ Creature | Defined$ Self
//         or SP$ Fight | ValidTgts$ Creature.YouCtrl | FightWith$ Creature.OpponentCtrl
//
// P/T is resolved via LayerEngine.computeCharacteristics to reflect pump/debuff
// effects already on the board. Cards that have null power (non-creatures) deal
// 0 damage per CR 701.12a.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class FightEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Fight";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const targetA = sa.targets[0];
    const targetB = sa.targets[1] ?? sa.sourceCardId;
    if (!targetA || !targetB) return;

    // Resolve effective P/T from the layer engine so pre-resolution pumps
    // (e.g. a Giant Growth on the stack that already resolved) are reflected.
    const charsA = game.layerEngine.computeCharacteristics(targetA);
    const charsB = game.layerEngine.computeCharacteristics(targetB);
    const powerA = charsA.power ?? 0;
    const powerB = charsB.power ?? 0;

    // CR 701.12a — both assignments happen simultaneously, so we issue both
    // before checking SBAs. The engine handles SBAs after the generator
    // returns; we do not gate on toughness here.
    if (powerA > 0) {
      yield* game.action.damage(targetA, "creature", targetB, powerA, false);
    }
    if (powerB > 0) {
      yield* game.action.damage(targetB, "creature", targetA, powerB, false);
    }
  }
}

effectRegistry.register(FightEffect);

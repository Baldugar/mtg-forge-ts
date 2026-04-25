// SPDX-License-Identifier: GPL-3.0-or-later
// PumpEffect — applies a +N/+M until-end-of-turn continuous effect to each
// target creature (CR 611.2a, Layer 7c). Registers a ContinuousEffect in the
// ContinuousEffectRegistry so the LayerEngine picks it up for P/T computation
// and the duration evaluator tears it down at cleanup (CR 514.3).
//
// Forge DSL: SP$ Pump | ValidTgts$ Creature | NumAtt$ 1 | NumDef$ 1
import type { ContinuousEffect } from "@mtg-forge-ts/core";
import { Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PumpEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Pump";

  // biome-ignore lint/correctness/useYield: ContinuousEffectRegistry.register is synchronous; no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const powerDelta = evaluateParamNumber(sa, "NumAtt", game);
    const toughnessDelta = evaluateParamNumber(sa, "NumDef", game);

    for (const _targetId of sa.targets) {
      const timestamp: number = game.newEntityId();
      const layer7c: Layer7cEffect = {
        kind: "modify",
        powerDelta,
        toughnessDelta,
        timestamp,
        sourceAbilityId: sa.sourceCardId,
      };
      const effect: ContinuousEffect = {
        id: game.newEntityId(),
        sourceCardId: sa.sourceCardId,
        timestamp,
        layer: Layer.L7c_PTModify,
        duration: { kind: "untilEndOfTurn" },
        payload: { kind: "pt-modify", effect: layer7c },
      };
      game.continuousEffectRegistry.register(effect);
    }
  }
}

effectRegistry.register(PumpEffect);

// SPDX-License-Identifier: GPL-3.0-or-later
// PumpEffect — applies a +N/+M continuous effect to each target creature
// (CR 611.2a, Layer 7c). Registers a ContinuousEffect in the
// ContinuousEffectRegistry so the LayerEngine picks it up for P/T computation
// and the duration evaluator tears it down at the proper boundary.
//
// Forge DSL: SP$ Pump | ValidTgts$ Creature | NumAtt$ 1 | NumDef$ 1
//
// Wave 53 broadens the Wave-1 MVP:
//   - IsCurse$ True            — flips the sign of NumAtt$/NumDef$ so the
//                                same handler covers debuff cards
//                                (Slime Mold, Disembowel) without a
//                                separate Debuff handler.
//   - IsPermanent$ True        — registers `Permanent` duration instead of
//                                UntilEndOfTurn (Auras, animate variants).
//   - Until$ <selector>        — overrides the default UEOT duration:
//                                  EndOfTurn      → untilEndOfTurn (default)
//                                  MyNextTurn     → untilEndOfYourNextTurn
//                                  EndOfCombat    → untilCombatEnds
//                                  Permanent      → permanent
import type { ContinuousEffect, EffectDuration } from "@mtg-forge-ts/core";
import { Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

function resolveDuration(sa: SpellAbility, game: Game): EffectDuration {
  if (isTrue(hasParam(sa, "IsPermanent") ? evaluateParamRaw(sa, "IsPermanent") : undefined)) {
    return { kind: "permanent" };
  }
  if (!hasParam(sa, "Until")) return { kind: "untilEndOfTurn" };
  const tok = evaluateParamRaw(sa, "Until").trim();
  switch (tok) {
    case "Permanent":
      return { kind: "permanent" };
    case "MyNextTurn":
    case "UntilMyNextTurn":
    case "UntilEndOfYourNextTurn":
      return {
        kind: "untilEndOfYourNextTurn",
        forSeat: sa.controllerSeat,
        registeredAtTurn: game.turn,
      };
    case "EndOfCombat":
      return { kind: "untilCombatEnds" };
    default:
      return { kind: "untilEndOfTurn" };
  }
}

export class PumpEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Pump";

  // biome-ignore lint/correctness/useYield: ContinuousEffectRegistry.register is synchronous; no EngineYield to emit
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    let powerDelta = hasParam(sa, "NumAtt") ? evaluateParamNumber(sa, "NumAtt", game) : 0;
    let toughnessDelta = hasParam(sa, "NumDef") ? evaluateParamNumber(sa, "NumDef", game) : 0;

    if (isTrue(hasParam(sa, "IsCurse") ? evaluateParamRaw(sa, "IsCurse") : undefined)) {
      powerDelta = -powerDelta;
      toughnessDelta = -toughnessDelta;
    }

    const duration = resolveDuration(sa, game);

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
        duration,
        payload: { kind: "pt-modify", effect: layer7c },
      };
      game.continuousEffectRegistry.register(effect);
    }
  }
}

effectRegistry.register(PumpEffect);

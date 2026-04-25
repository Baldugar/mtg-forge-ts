// SPDX-License-Identifier: GPL-3.0-or-later
// BranchEffect — handles Forge's `SP$ Branch` conditional-dispatch effect.
// Evaluates BranchConditionSVar$ (as a number; nonzero = truthy) and resolves
// either TrueSubAbility$ or FalseSubAbility$ based on the result.
//
// Forge DSL:
//   SP$ Branch | BranchConditionSVar$ X | TrueSubAbility$ DBA | FalseSubAbility$ DBB
//   SP$ Branch | BranchConditionSVar$ CheckSVar | TrueSubAbility$ DBTrue
//     | FalseSubAbility$ DBFalse
//
// When BranchConditionSVar$ is absent, TrueSubAbility$ is run unconditionally
// (semantically equivalent to "no condition guard").
import type { ParamValue } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { evaluateSVar } from "../../svar/index.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class BranchEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Branch";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const ctx: SvarContext = {
      game,
      sourceCardId: sa.sourceCardId,
      svars: sa.svars,
      controller: sa.controllerSeat,
      targets: sa.targets,
      ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
    };

    // Determine which sub-ability to run by evaluating the condition SVar.
    let branchKey: string | null;
    if (hasParam(sa, "BranchConditionSVar")) {
      const condSVarName = evaluateParamRaw(sa, "BranchConditionSVar");
      // Look up the SVar and evaluate it as a number.
      const condSVar = sa.svars.get(condSVarName);
      let condValue: number;
      if (condSVar === undefined) {
        // If the SVar doesn't exist, treat the raw param name as a literal number.
        condValue = Number(condSVarName);
        if (Number.isNaN(condValue)) condValue = 0;
      } else {
        // Build a synthetic ParamValue pointing at the named SVar.
        const pv: ParamValue = { kind: "svarRef", name: condSVarName };
        try {
          const result = evaluateSVar(pv, ctx);
          condValue = typeof result === "number" ? result : 0;
        } catch {
          condValue = 0;
        }
      }
      const isTruthy = condValue !== 0;
      if (isTruthy) {
        branchKey = hasParam(sa, "TrueSubAbility") ? evaluateParamRaw(sa, "TrueSubAbility") : null;
      } else {
        branchKey = hasParam(sa, "FalseSubAbility") ? evaluateParamRaw(sa, "FalseSubAbility") : null;
      }
    } else {
      // No condition — run TrueSubAbility unconditionally, fallback to FalseSubAbility.
      branchKey = hasParam(sa, "TrueSubAbility")
        ? evaluateParamRaw(sa, "TrueSubAbility")
        : hasParam(sa, "FalseSubAbility")
          ? evaluateParamRaw(sa, "FalseSubAbility")
          : null;
    }

    if (branchKey === null) {
      // No sub-abilities defined for this branch — no-op.
      return;
    }

    let ability: ReturnType<typeof evaluateSVarAsAbility>;
    try {
      ability = evaluateSVarAsAbility(branchKey, ctx);
    } catch {
      // SVar not found or not an ability — safe no-op.
      return;
    }

    const cls = effectRegistry.lookup(ability.handlerKey);
    if (!cls) return;

    const subAst = {
      kind: "spell" as const,
      effect: ability,
      cost: { raw: "" },
    };
    const subSa = new SpellAbility(subAst, sa.sourceCardId, sa.controllerSeat, sa.svars, sa.targets);
    yield* cls.prototype.resolve.call(new cls(), subSa, game);
  }
}

effectRegistry.register(BranchEffect);

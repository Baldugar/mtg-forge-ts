// SPDX-License-Identifier: GPL-3.0-or-later
// BranchEffect — handles Forge's `SP$ Branch` conditional-dispatch effect.
// Evaluates a condition SVar (BranchConditionSVar$) and resolves either
// TrueSubAbility$ or FalseSubAbility$ based on the result.
//
// Forge DSL:
//   SP$ Branch | BranchConditionSVar$ X | TrueSubAbility$ DBA | FalseSubAbility$ DBB
//   SP$ Branch | BranchConditionSVar$ CheckSVar | TrueSubAbility$ DBTrue
//     | FalseSubAbility$ DBFalse
//
// MVP STATUS: STUB — resolves TrueSubAbility$ unconditionally (condition
// evaluation deferred). If no TrueSubAbility$ is present, tries FalseSubAbility$.
// Registered so the semantic validator stops flagging Branch as an unknown key.
//
// TODO(SP3): evaluate BranchConditionSVar$ via evaluateSVar (numeric / boolean);
// if result > 0 (or "true") pick TrueSubAbility$, else FalseSubAbility$.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class BranchEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Branch";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Determine which sub-ability to run. MVP: always take True branch.
    const branchKey = hasParam(sa, "TrueSubAbility")
      ? evaluateParamRaw(sa, "TrueSubAbility")
      : hasParam(sa, "FalseSubAbility")
        ? evaluateParamRaw(sa, "FalseSubAbility")
        : null;

    if (branchKey === null) {
      // No sub-abilities defined — no-op.
      return;
    }

    const ctx: SvarContext = {
      game,
      sourceCardId: sa.sourceCardId,
      svars: sa.svars,
      controller: sa.controllerSeat,
      targets: sa.targets,
      ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
    };

    let ability: ReturnType<typeof evaluateSVarAsAbility>;
    try {
      ability = evaluateSVarAsAbility(branchKey, ctx);
    } catch {
      // SVar not found or not an ability — safe no-op for MVP.
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

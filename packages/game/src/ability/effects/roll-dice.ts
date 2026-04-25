// SPDX-License-Identifier: GPL-3.0-or-later
// RollDiceEffect — handles Forge's `SP$ RollDice` effect line.
// Rolls N dice with M sides using game.rng (deterministic, seed-controlled).
// Emits a RollDie event per die rolled, then dispatches ResultSubAbility$ if
// present with xValue set to the total.
//
// Forge DSL:
//   SP$ RollDice | NumSides$ 6 | NumDice$ 1 | ResultSubAbility$ DBCheck
//   SP$ RollDice | NumSides$ 20 | NumDice$ 1 | ResultSubAbility$ DBResult
import { mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class RollDiceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RollDice";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const sides = hasParam(sa, "NumSides") ? evaluateParamNumber(sa, "NumSides", game) : 6;
    const num = hasParam(sa, "NumDice") ? evaluateParamNumber(sa, "NumDice", game) : 1;

    let total = 0;
    for (let i = 0; i < num; i++) {
      // nextInt(1, sides + 1) → uniform integer in [1, sides].
      const result = game.rng.nextInt(1, sides + 1);
      total += result;
      yield game.emitEvent(
        mkEvent("RollDie", game.turn, game.phase, {
          playerSeat: sa.controllerSeat,
          sides,
          result,
        }),
      );
    }

    // Dispatch ResultSubAbility$ (if present) with xValue = total.
    if (!hasParam(sa, "ResultSubAbility")) return;
    const subName = evaluateParamRaw(sa, "ResultSubAbility");

    const ctx: SvarContext = {
      game,
      sourceCardId: sa.sourceCardId,
      svars: sa.svars,
      controller: sa.controllerSeat,
      targets: sa.targets,
      xValue: total,
    };

    let ability: ReturnType<typeof evaluateSVarAsAbility>;
    try {
      ability = evaluateSVarAsAbility(subName, ctx);
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
    const subSa = new SpellAbility(subAst, sa.sourceCardId, sa.controllerSeat, sa.svars, sa.targets, total);
    yield* cls.prototype.resolve.call(new cls(), subSa, game);
  }
}

effectRegistry.register(RollDiceEffect);

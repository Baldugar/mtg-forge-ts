// SPDX-License-Identifier: GPL-3.0-or-later
// FlipACoinEffect — handles Forge's `SP$ FlipACoin` effect line.
// Flips a coin and resolves HeadsSubAbility$ or TailsSubAbility$ depending
// on the result.
//
// Forge DSL:
//   SP$ FlipACoin | HeadsSubAbility$ DBHeads | TailsSubAbility$ DBTails
//   SP$ FlipACoin | HeadsSubAbility$ DBWin | TailsSubAbility$ DBLose
//
// MVP STATUS: deterministic "heads" (always picks HeadsSubAbility$). The RNG
// flip is deferred to SP3 when game.rng.flipCoin() lands. Registered so the
// semantic validator stops flagging FlipACoin as an unknown handler key.
//
// TODO(SP3): call game.rng.flipCoin() (or yield a flipCoin decision) and
// pick HeadsSubAbility$ vs TailsSubAbility$ based on the result.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class FlipACoinEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "FlipACoin";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // MVP: always heads. Pick HeadsSubAbility$ if present, else TailsSubAbility$.
    const branchKey = hasParam(sa, "HeadsSubAbility")
      ? evaluateParamRaw(sa, "HeadsSubAbility")
      : hasParam(sa, "TailsSubAbility")
        ? evaluateParamRaw(sa, "TailsSubAbility")
        : null;

    if (branchKey === null) return;

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

effectRegistry.register(FlipACoinEffect);

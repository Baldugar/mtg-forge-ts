// SPDX-License-Identifier: GPL-3.0-or-later
// FlipACoinEffect — handles Forge's `SP$ FlipACoin` effect line.
// Flips a coin using game.rng and resolves HeadsSubAbility$ or TailsSubAbility$
// depending on the result. Emits a FlipCoin event with the outcome.
//
// Forge DSL:
//   SP$ FlipACoin | HeadsSubAbility$ DBHeads | TailsSubAbility$ DBTails
//   SP$ FlipACoin | HeadsSubAbility$ DBWin | TailsSubAbility$ DBLose
import { mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { flipCoinModifier } from "../../statics/wave78-gate-helpers.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class FlipACoinEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "FlipACoin";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Wave 78 — consult any active FlipCoinMod static for this player.
    // Edgar / Krark's-Thumb-shape statics override the canonical CR 705
    // random-outcome flow:
    //   - forced-heads / forced-tails → result is dictated, no RNG draw.
    //   - double-flip-pick            → flip 2 coins, take whichever
    //                                    is heads (controller-preferred);
    //                                    falls back to tails iff both
    //                                    are tails.
    const mod = flipCoinModifier(game, sa.controllerSeat);
    let isHeads: boolean;
    switch (mod.mode) {
      case "forced-heads":
        isHeads = true;
        break;
      case "forced-tails":
        isHeads = false;
        break;
      case "double-flip-pick": {
        const a = game.rng.nextInt(0, 2) === 1;
        const b = game.rng.nextInt(0, 2) === 1;
        // "Pick the better result" — Krark's Thumb chooses heads when
        // either coin came up heads (heads being the canonical "win").
        isHeads = a || b;
        break;
      }
      default:
        // Flip: 0 → tails, 1 → heads (nextInt(0,2) is uniform over {0,1}).
        isHeads = game.rng.nextInt(0, 2) === 1;
        break;
    }

    yield game.emitEvent(
      mkEvent("FlipCoin", game.turn, game.phase, {
        playerSeat: sa.controllerSeat,
        resultHeads: isHeads,
      }),
    );

    // Pick the appropriate branch key.
    const branchParamKey = isHeads ? "HeadsSubAbility" : "TailsSubAbility";
    const fallbackParamKey = isHeads ? "TailsSubAbility" : "HeadsSubAbility";

    const subName = hasParam(sa, branchParamKey)
      ? evaluateParamRaw(sa, branchParamKey)
      : hasParam(sa, fallbackParamKey)
        ? evaluateParamRaw(sa, fallbackParamKey)
        : null;

    if (subName === null) return;

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
      ability = evaluateSVarAsAbility(subName, ctx);
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

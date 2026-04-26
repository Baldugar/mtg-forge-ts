// SPDX-License-Identifier: GPL-3.0-or-later
// ChannelEffect — resolver for the synthesized Channel activated ability
// (Champions / Saviors of Kamigawa, CR 702.74).
//
// CR 702.74a — "Channel — [cost], Discard this card: [effect]." After
// the keyword handler's hand-zone activated SpellAbility pays its mana
// + DiscardSelf cost, this resolver looks up the named SVar (passed in
// via params.EffectSVar) on sa.svars and dispatches the inner
// EffectInvocation through the effect registry.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class ChannelEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Channel";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const svarName = evaluateParamRaw(sa, "EffectSVar");
    if (!svarName) return;
    const svar = sa.svars.get(svarName);
    if (!svar || !svar.ability) {
      // No matching SVar / no ability body — nothing to dispatch. Channel
      // resolves as a no-op (the discard already happened during cost
      // payment). Documented for diagnostic clarity.
      return;
    }

    // Build a synthetic AbilityAst from the SVar's EffectInvocation and
    // delegate to the registered handler.
    const innerAst = {
      kind: "activated" as const,
      effect: svar.ability,
      cost: { raw: "0" },
    };
    const innerSa = new SpellAbility(
      innerAst,
      sa.sourceCardId,
      sa.controllerSeat,
      sa.svars,
      sa.targets,
      sa.xValue,
    );
    const cls = effectRegistry.lookup(svar.ability.handlerKey);
    if (!cls) return;
    const effect = new cls();
    yield* effect.resolve(innerSa, game);
  }
}

effectRegistry.register(ChannelEffect);

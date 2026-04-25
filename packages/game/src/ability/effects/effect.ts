// SPDX-License-Identifier: GPL-3.0-or-later
// EffectEffect — meta-effect wrapper for Forge's "Effect" handler (68+ cards).
//
// In Forge, `Effect` creates a hidden anonymous permanent on the battlefield
// that hosts triggered and replacement abilities (e.g. delayed triggers:
// "At the beginning of your next end step, draw a card"). True Effect
// semantics require a delayed-trigger host object; that infrastructure lands
// in a future wave (Part E3 / D6).
//
// MVP behaviour (Part D Wave 5): if a SubAbility$ is present, resolve it
// inline immediately. This handles the common "Effect as pass-through
// wrapper" pattern. Cards that rely on true delay semantics remain stubs
// until the delayed-trigger queue is wired into this handler.
//
// Forge DSL examples:
//   A:SP$ Effect | SubAbility$ DBDraw
//   A:SP$ Effect | Mode$ RaiseDead | …   ← no SubAbility; currently no-op
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

export class EffectEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Effect";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    if (!hasParam(sa, "SubAbility")) {
      // No sub-ability — in full Forge semantics this creates an empty Effect
      // host for delayed triggers. MVP: no-op until delayed-trigger host is
      // implemented (Part E3).
      return;
    }

    const subAbilityName = evaluateParamRaw(sa, "SubAbility");

    const ctx: SvarContext = {
      game,
      sourceCardId: sa.sourceCardId,
      svars: sa.svars,
      controller: sa.controllerSeat,
      targets: sa.targets,
      ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
    };

    const ability = evaluateSVarAsAbility(subAbilityName, ctx);
    const cls = effectRegistry.lookup(ability.handlerKey);
    if (!cls) {
      // SubAbility references an unknown handler — silent no-op for MVP.
      // The effect still "happened" as far as the stack is concerned; we
      // just can't resolve its sub-effects yet.
      return;
    }

    const subAst = {
      kind: "spell" as const,
      effect: ability,
      cost: { raw: "" },
    };
    const subSa = new SpellAbility(
      subAst,
      sa.sourceCardId,
      sa.controllerSeat,
      sa.svars,
      sa.targets,
      sa.xValue,
    );
    yield* new cls().resolve(subSa, game);
  }
}

effectRegistry.register(EffectEffect);

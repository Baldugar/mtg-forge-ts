// SPDX-License-Identifier: GPL-3.0-or-later
//
// M6.18 — `SubAbility$` chain runner. Mirrors Forge's
// `AbilityFactory.resolveSubAbilities` (forge-game) which is invoked at the
// end of every spell/ability resolution to walk the linked SubAbility tree
// in source-order and resolve each link inline (no new stack frame per CR
// 113.2 — these are part of the parent's resolution).
//
// Previously each effect was responsible for calling its own SubAbility
// chain. Most effects didn't (only the SP$ Effect host explicitly chained
// it), so spells like Vampiric Tutor (`SP$ ChangeZone | SubAbility$ DBLife`)
// silently dropped the life-loss leg of their resolution. Centralising the
// chain at the resolver-level matches Forge and closes the gap for every
// effect at once without each handler needing to remember.

import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import { evaluateSVarAsAbility } from "../svar/ability-eval.js";
import type { SvarContext } from "../svar/context.js";
import { effectRegistry } from "./effect-registry.js";
import { evaluateParamRaw, hasParam } from "./evaluate-param.js";
import { SpellAbility } from "./spell-ability.js";

export function* runSubAbilityChain(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
  if (!hasParam(sa, "SubAbility")) return;
  const subAbilityName = evaluateParamRaw(sa, "SubAbility");
  const ctx: SvarContext = {
    game,
    sourceCardId: sa.sourceCardId,
    svars: sa.svars,
    controller: sa.controllerSeat,
    targets: sa.targets,
    ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
  };
  let ability: ReturnType<typeof evaluateSVarAsAbility> | undefined;
  try {
    ability = evaluateSVarAsAbility(subAbilityName, ctx);
  } catch {
    // M6.18 — SubAbility$ chain is a Forge-canonical post-effect step, but
    // unsupported sub-effects (TokenScript$ <unknown>, Count$<unknown>,
    // missing SVar names from synthetic test scripts) shouldn't kill the
    // parent's resolution. Forge's resolveSubAbilities() in this case logs
    // and continues with the parent's resolved state. Mirror that here so
    // the head effect's events stay observable.
    return;
  }
  if (!ability) return;
  const cls = effectRegistry.lookup(ability.handlerKey);
  if (!cls) return;
  const subAst = {
    kind: "spell" as const,
    effect: ability,
    cost: { raw: "" },
  };
  const subSa = new SpellAbility(subAst, sa.sourceCardId, sa.controllerSeat, sa.svars, sa.targets, sa.xValue);
  try {
    yield* new cls().resolve(subSa, game);
    // Recursively chain — Forge's SubAbility chains can nest
    // (DBA → DBB → DBC). Note: this walks the SVar links via subSa, NOT
    // sa, so each link picks up its own SubAbility$ param.
    yield* runSubAbilityChain(subSa, game);
  } catch {
    // Same rationale as the evaluateSVarAsAbility try — unsupported sub-
    // effect resolution should not fail the parent. Log-and-continue is
    // Forge's behavior for resolveSubAbilities.
  }
}

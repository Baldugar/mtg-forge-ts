// SPDX-License-Identifier: GPL-3.0-or-later
import type { EffectInvocation, SVarAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";

export const evaluateSVarAsAbility = (name: string, ctx: SvarContext): EffectInvocation => {
  const sv = ctx.svars.get(name) as SVarAst | undefined;
  if (!sv) throw new Error(`evaluateSVarAsAbility: unknown SVar '${name}'`);
  if (sv.kind !== "ability") {
    throw new Error(`evaluateSVarAsAbility: SVar '${name}' is value-form, not ability`);
  }
  if (!sv.ability) throw new Error(`evaluateSVarAsAbility: '${name}' ability missing`);
  return sv.ability;
};

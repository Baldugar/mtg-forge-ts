// SPDX-License-Identifier: GPL-3.0-or-later
import type { EffectInvocation, ParamValue, SVarAst, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";
import { selectorRegistry } from "./selector-registry.js";

const parseLiteralNumber = (raw: string): number => {
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`evaluateSVar: literal '${raw}' is not a number`);
  return n;
};

export function evaluateSVar(pv: ParamValue, ctx: SvarContext): number | EffectInvocation {
  switch (pv.kind) {
    case "literal":
      return parseLiteralNumber(pv.raw);
    case "svarRef":
      return evaluateSVarByName(pv.name, ctx);
    case "expression":
      return evaluateExpression(pv.ast, ctx);
  }
}

const evaluateSVarByName = (name: string, ctx: SvarContext): number | EffectInvocation => {
  const sv = ctx.svars.get(name) as SVarAst | undefined;
  if (!sv) throw new Error(`evaluateSVar: unknown SVar '${name}'`);
  if (sv.kind === "ability") {
    if (!sv.ability) throw new Error(`evaluateSVar: ability SVar '${name}' has no ability`);
    return sv.ability;
  }
  if (sv.expression) return evaluateExpression(sv.expression, ctx);
  return parseLiteralNumber(sv.raw);
};

export const evaluateExpression = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const fn = selectorRegistry.lookup(ast.kind);
  if (!fn) throw new Error(`evaluateSVar: unknown SVar selector '${ast.kind}'`);
  return fn(ast, ctx);
};

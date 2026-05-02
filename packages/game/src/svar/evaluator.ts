// SPDX-License-Identifier: GPL-3.0-or-later
import type { EffectInvocation, ParamValue, SVarAst, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";
import { selectorRegistry } from "./selector-registry.js";

// M6.16 — Forge's printed form `NumCards$ DevotionB` (or `LifeAmount$ NumGY`,
// or `Power$ X-1`) ends up in the AST as a `literal` because the parser's
// SVAR_REF_RE only catches single-letter X/Y/Z and DB-prefixed names. At
// evaluation time we still need to resolve such names against the svars
// map, fold the special "All" sentinel, and accept simple `<X>+N`/`<X>-N`
// arithmetic. We do this here (post-classification) so existing literals
// that happen to be plain numbers still parse fast.
const ALL_SENTINEL = -1; // SP$ Discard sees `All` and treats it as "every card"
const ARITHMETIC_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*([+\-])\s*(\d+)$/;

const resolveLiteralOrName = (raw: string, ctx: SvarContext): number => {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  // Plain number (incl. negative).
  const direct = Number(trimmed);
  if (!Number.isNaN(direct)) return direct;
  // "All" — Forge's wildcard quantity for whole-zone effects.
  if (trimmed === "All") return ALL_SENTINEL;
  // SVar lookup by name.
  const sv = ctx.svars.get(trimmed) as SVarAst | undefined;
  if (sv) return resolveSVarNumeric(sv, trimmed, ctx);
  // Bare X / Y / Z (also legal as literal when classifier didn't catch).
  if (trimmed === "X" || trimmed === "Y" || trimmed === "Z") {
    return ctx.xValue ?? 0;
  }
  if (trimmed === "-X") return -(ctx.xValue ?? 0);
  // Simple `<Name>+N` / `<Name>-N` arithmetic — Forge corpus uses this in
  // Pump+1/-1 forms (`NumAtt$ X+1`, `NumDef$ X-2`).
  const m = ARITHMETIC_RE.exec(trimmed);
  if (m) {
    const lhsName = m[1] ?? "";
    const op = m[2] ?? "+";
    const rhs = Number.parseInt(m[3] ?? "0", 10);
    const lhs = resolveLiteralOrName(lhsName, ctx);
    return op === "+" ? lhs + rhs : lhs - rhs;
  }
  throw new Error(`evaluateSVar: literal '${raw}' is not a number`);
};

const resolveSVarNumeric = (sv: SVarAst, name: string, ctx: SvarContext): number => {
  if (sv.kind === "ability") {
    throw new Error(`evaluateSVar: SVar '${name}' is an ability, expected numeric`);
  }
  if (sv.expression) return evaluateExpression(sv.expression, ctx);
  return resolveLiteralOrName(sv.raw, ctx);
};

export function evaluateSVar(pv: ParamValue, ctx: SvarContext): number | EffectInvocation {
  switch (pv.kind) {
    case "literal":
      return resolveLiteralOrName(pv.raw, ctx);
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
  return resolveLiteralOrName(sv.raw, ctx);
};

export const evaluateExpression = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const fn = selectorRegistry.lookup(ast.kind);
  if (!fn) throw new Error(`evaluateSVar: unknown SVar selector '${ast.kind}'`);
  return fn(ast, ctx);
};

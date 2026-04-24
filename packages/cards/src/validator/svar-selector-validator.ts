// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  AbilityAst,
  CardDefinition,
  EffectInvocation,
  ReplacementAst,
  SVarAst,
  SVarExpressionAst,
  StaticAst,
  TriggerAst,
} from "@mtg-forge-ts/core";
import { isKnownSvarSelector } from "./svar-selector-kinds.js";
import { registerValidator } from "./validate-card.js";
import type { ValidationIssue } from "./validate-card.js";

const walkExpression = (expr: SVarExpressionAst, path: string, out: ValidationIssue[]): void => {
  if (!isKnownSvarSelector(expr.kind)) {
    out.push({
      severity: "warning",
      message: `unknown SVar selector kind '${expr.kind}' in '${expr.raw ?? expr.kind}'`,
      path,
    });
  }
  if (expr.args) {
    for (let i = 0; i < expr.args.length; i++) {
      const a = expr.args[i];
      if (a) walkExpression(a, `${path}.args[${i}]`, out);
    }
  }
};

const walkInvocation = (inv: EffectInvocation, path: string, out: ValidationIssue[]): void => {
  for (const [k, pv] of Object.entries(inv.params)) {
    if (pv.kind === "expression") {
      walkExpression(pv.ast, `${path}.params.${k}`, out);
    }
  }
  if (inv.subAbility) walkInvocation(inv.subAbility, `${path}.subAbility`, out);
};

const validateSvarSelectors = (card: CardDefinition, path: string): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < (card.abilities as readonly AbilityAst[]).length; i++) {
    const a = (card.abilities as readonly AbilityAst[])[i];
    if (a) walkInvocation(a.effect, `${path}.abilities[${i}]`, issues);
  }

  for (let i = 0; i < (card.triggers as readonly TriggerAst[]).length; i++) {
    const t = (card.triggers as readonly TriggerAst[])[i];
    if (!t) continue;
    walkInvocation(t.effect, `${path}.triggers[${i}]`, issues);
    for (const [k, pv] of Object.entries(t.params)) {
      if (pv.kind === "expression") {
        walkExpression(pv.ast, `${path}.triggers[${i}].params.${k}`, issues);
      }
    }
  }

  for (let i = 0; i < (card.replacements as readonly ReplacementAst[]).length; i++) {
    const r = (card.replacements as readonly ReplacementAst[])[i];
    if (!r) continue;
    walkInvocation(r.effect, `${path}.replacements[${i}]`, issues);
    for (const [k, pv] of Object.entries(r.params)) {
      if (pv.kind === "expression") {
        walkExpression(pv.ast, `${path}.replacements[${i}].params.${k}`, issues);
      }
    }
  }

  for (let i = 0; i < (card.statics as readonly StaticAst[]).length; i++) {
    const s = (card.statics as readonly StaticAst[])[i];
    if (!s) continue;
    for (const [k, pv] of Object.entries(s.params)) {
      if (pv.kind === "expression") {
        walkExpression(pv.ast, `${path}.statics[${i}].params.${k}`, issues);
      }
    }
  }

  const svars = card.svars as ReadonlyMap<string, SVarAst>;
  for (const [name, sv] of svars) {
    if (sv.expression) {
      walkExpression(sv.expression, `${path}.svars.${name}`, issues);
    }
  }

  return issues;
};

registerValidator(validateSvarSelectors);

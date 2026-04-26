// SPDX-License-Identifier: GPL-3.0-or-later
import type { AbilityAst, EffectInvocation, ParamValue, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

// Matches X, Y, Z (single svar reference variables) or DB-prefixed sub-ability names
const SVAR_REF_RE = /^[XYZ]$|^DB[A-Z]\w*$/;

// Param keys whose values are SVar BINDING names rather than references —
// the parameter declares "store the result of this effect into SVar <name>"
// (e.g. RollDice's `ResultSVar$ X` stores the rolled value into X). Treat
// the value as a literal so the resolver does not flag X/Y/Z as unresolved.
//
// Note: classifyParamValue is called without the parameter key context (it
// only sees the raw value). We expose this set so the per-line parsers can
// special-case binding params before calling classifyParamValue.
export const SVAR_BINDING_PARAMS: ReadonlySet<string> = new Set<string>([
  "ResultSVar",
  "ChosenSVar",
  "OtherSVar",
  "ExcessSVar",
  "Announce",
  "Monstrosity",
  "ConvertResult",
]);

export const classifyParamValue = (raw: string): ParamValue => {
  if (SVAR_REF_RE.test(raw)) return { kind: "svarRef", name: raw };
  if (raw.includes("$")) {
    const dollar = raw.indexOf("$");
    const kind = raw.slice(0, dollar);
    const rest = raw.slice(dollar + 1);
    const ast: SVarExpressionAst = {
      kind,
      raw,
      ...(rest === "" ? {} : { args: [{ kind: "literal", raw: rest }] }),
    };
    return { kind: "expression", ast };
  }
  return { kind: "literal", raw };
};

export const parseAbilityLine = (line: LexedLine): AbilityAst => {
  if (line.prefix !== "A") {
    throw new Error(`parseAbilityLine: expected prefix 'A', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  let kind: "spell" | "activated" = "spell";
  let handlerKey: string | null = null;
  let costRaw = "";
  const params: Record<string, ParamValue> = {};

  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "SP" || k === "DB") {
        kind = "spell";
        handlerKey = v;
      } else if (k === "AB" || k === "ST" || k === "RA") {
        // AB$ = activated, ST$ = static-activated (used by cards like
        // Circling Vultures whose discard ability functions as a static
        // permission), RA$ = replacement-activated ("repurposed activated").
        // All three resolve identically through the activated path.
        kind = "activated";
        handlerKey = v;
      } else if (k === "Cost") {
        costRaw = v;
      } else if (SVAR_BINDING_PARAMS.has(k)) {
        // Binding param — value names a target SVar slot, not a reference.
        params[k] = { kind: "literal", raw: v };
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (handlerKey === null) {
    throw new Error(`parseAbilityLine: no SP$/AB$/DB$ handler key found at line ${line.lineNumber}`);
  }

  const effect: EffectInvocation = { handlerKey, params };
  return { kind, effect, cost: { raw: costRaw } };
};

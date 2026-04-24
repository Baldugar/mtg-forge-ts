// SPDX-License-Identifier: GPL-3.0-or-later
import type { AbilityAst, EffectInvocation, ParamValue, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { LexedLine } from "./lexer.js";

// Matches X, Y, Z (single svar reference variables) or DB-prefixed sub-ability names
const SVAR_REF_RE = /^[XYZ]$|^DB[A-Z]\w*$/;

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
      } else if (k === "AB") {
        kind = "activated";
        handlerKey = v;
      } else if (k === "Cost") {
        costRaw = v;
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

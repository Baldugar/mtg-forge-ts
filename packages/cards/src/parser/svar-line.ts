// SPDX-License-Identifier: GPL-3.0-or-later
import type { EffectInvocation, ParamValue, SVarAst, SVarExpressionAst } from "@mtg-forge-ts/core";
import { classifyParamValue } from "./ability-line.js";
import type { LexedLine } from "./lexer.js";

export const parseSVarLine = (line: LexedLine): { readonly name: string; readonly ast: SVarAst } => {
  if (line.prefix !== "SVar") {
    throw new Error(`parseSVarLine: expected prefix 'SVar', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  const firstColon = line.content.indexOf(":");
  if (firstColon < 0) {
    throw new Error(`parseSVarLine: missing ':' separator at line ${line.lineNumber}`);
  }
  const name = line.content.slice(0, firstColon).trim();
  const head = line.content.slice(firstColon + 1).trim();

  // Ability SVar — starts with "DB$ <handler>"
  if (head.startsWith("DB$ ") || head === "DB$") {
    const handlerKey = head.slice(4).trim();
    // Gather additional params from tokens, skipping any spurious token
    // whose key contains ':' (artifact from segment-0 parsing of "name:DB")
    const params: Record<string, ParamValue> = {};
    for (const tok of line.tokens) {
      for (const [k, v] of tok) {
        if (k.includes(":")) continue; // spurious "name:DB"-type token from segment 0
        params[k] = classifyParamValue(v);
      }
    }
    const ability: EffectInvocation = { handlerKey, params };
    return { name, ast: { kind: "ability", raw: head, ability } };
  }

  // Value SVar — head may be an expression like "Count$xPaid" or a plain literal like "5"
  const dollar = head.indexOf("$");
  if (dollar < 0) {
    // Plain literal value (no expression)
    return { name, ast: { kind: "value", raw: head } };
  }

  // Expression: "Kind$args"
  const exprKind = head.slice(0, dollar);
  const exprArgs = head.slice(dollar + 1);
  const expression: SVarExpressionAst = {
    kind: exprKind,
    raw: head,
    ...(exprArgs !== "" ? { args: [{ kind: "literal", raw: exprArgs }] } : {}),
  };
  return { name, ast: { kind: "value", raw: head, expression } };
};

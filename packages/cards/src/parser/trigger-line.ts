// SPDX-License-Identifier: GPL-3.0-or-later
import type { ParamValue, TriggerAst } from "@mtg-forge-ts/core";
import { classifyParamValue } from "./ability-line.js";
import type { LexedLine } from "./lexer.js";

export const parseTriggerLine = (line: LexedLine): TriggerAst => {
  if (line.prefix !== "T") {
    throw new Error(`parseTriggerLine: expected prefix 'T', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  let mode: string | null = null;
  let executeKey: string | null = null;
  const params: Record<string, ParamValue> = {};

  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Mode") {
        mode = v;
      } else if (k === "Execute") {
        executeKey = v;
      } else if (k === "TriggerDescription") {
        // skip — description text is not captured in the AST
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (mode === null) {
    throw new Error(`parseTriggerLine: missing Mode$ at line ${line.lineNumber}`);
  }
  if (executeKey === null) {
    throw new Error(`parseTriggerLine: missing Execute$ at line ${line.lineNumber}`);
  }

  return {
    mode,
    params,
    effect: { handlerKey: executeKey, params: {} },
  };
};

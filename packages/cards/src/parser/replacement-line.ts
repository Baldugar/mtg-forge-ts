// SPDX-License-Identifier: GPL-3.0-or-later
import { type ParamValue, type ReplacementAst, replacementTypeFromName } from "@mtg-forge-ts/core";
import { classifyParamValue } from "./ability-line.js";
import type { LexedLine } from "./lexer.js";

export const parseReplacementLine = (line: LexedLine): ReplacementAst => {
  if (line.prefix !== "R") {
    throw new Error(
      `parseReplacementLine: expected prefix 'R', got '${line.prefix}' at line ${line.lineNumber}`,
    );
  }
  let eventKind: string | null = null;
  let replaceWith: string | null = null;
  let isSelf = false;
  const params: Record<string, ParamValue> = {};

  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Event") {
        const canonical = replacementTypeFromName(v);
        if (canonical === null) {
          throw new Error(`parseReplacementLine: unknown Event$ '${v}' at line ${line.lineNumber}`);
        }
        eventKind = canonical;
      } else if (k === "ReplaceWith") {
        replaceWith = v;
      } else if (k === "Self") {
        isSelf = v.toLowerCase() === "true";
      } else if (k === "Description") {
        // skip — description text is not captured in the AST
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (eventKind === null) {
    throw new Error(`parseReplacementLine: missing Event$ at line ${line.lineNumber}`);
  }
  if (replaceWith === null) {
    throw new Error(`parseReplacementLine: missing ReplaceWith$ at line ${line.lineNumber}`);
  }

  return {
    eventKind,
    params,
    effect: { handlerKey: replaceWith, params: {} },
    ...(isSelf ? { isSelf: true } : {}),
  };
};

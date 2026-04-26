// SPDX-License-Identifier: GPL-3.0-or-later
import { type ParamValue, type ReplacementAst, replacementTypeFromName } from "@mtg-forge-ts/core";
import { SVAR_BINDING_PARAMS, classifyParamValue } from "./ability-line.js";
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
      } else if (SVAR_BINDING_PARAMS.has(k)) {
        params[k] = { kind: "literal", raw: v };
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (eventKind === null) {
    throw new Error(`parseReplacementLine: missing Event$ at line ${line.lineNumber}`);
  }

  // Prevention-style replacements (e.g. "This spell can't be countered",
  // "prevent N damage", "skip your draw step") use Layer$ CantHappen,
  // Prevent$ True, or Skip$ True instead of providing a ReplaceWith$ SVar.
  // Treat these as optional and synthesise a "Prevent" handlerKey so the
  // resolver does not attempt a DB lookup.
  const layerParam = params.Layer;
  const preventParam = params.Prevent;
  const skipParam = params.Skip;
  const layerRaw = layerParam?.kind === "literal" ? layerParam.raw : undefined;
  const preventRaw = preventParam?.kind === "literal" ? preventParam.raw : undefined;
  const skipRaw = skipParam?.kind === "literal" ? skipParam.raw : undefined;
  const isPreventStyle = layerRaw === "CantHappen" || preventRaw === "True" || skipRaw === "True";

  if (replaceWith === null && !isPreventStyle) {
    throw new Error(`parseReplacementLine: missing ReplaceWith$ at line ${line.lineNumber}`);
  }

  const handlerKey = replaceWith ?? "Prevent";

  return {
    eventKind,
    params,
    effect: { handlerKey, params: {} },
    ...(isSelf ? { isSelf: true } : {}),
  };
};

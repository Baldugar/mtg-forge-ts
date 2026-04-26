// SPDX-License-Identifier: GPL-3.0-or-later
import type { ParamValue, TriggerAst } from "@mtg-forge-ts/core";
import { SVAR_BINDING_PARAMS, classifyParamValue } from "./ability-line.js";
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
      } else if (SVAR_BINDING_PARAMS.has(k)) {
        params[k] = { kind: "literal", raw: v };
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (mode === null) {
    throw new Error(`parseTriggerLine: missing Mode$ at line ${line.lineNumber}`);
  }
  // Forge allows trigger lines with no Execute$ — these are watcher-only
  // triggers used by static effects (Stalwart Realmwarden's ChangesZone +
  // ForgetOnCast$ pattern) that don't push a stack item but mutate cards
  // tracked by the host static. We emit a sentinel handlerKey "NoOp" that
  // the trigger-handler-registry maps to a no-op resolver; the static or
  // accompanying trigger-watcher handles the real semantics.
  const handlerKey = executeKey ?? "NoOp";

  return {
    mode,
    params,
    effect: { handlerKey, params: {} },
  };
};

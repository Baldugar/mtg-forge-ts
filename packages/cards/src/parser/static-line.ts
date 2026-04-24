// SPDX-License-Identifier: GPL-3.0-or-later
import {
  type ParamValue,
  type StaticAst,
  type ZoneType,
  staticAbilityModeFromName,
} from "@mtg-forge-ts/core";
import { classifyParamValue } from "./ability-line.js";
import type { LexedLine } from "./lexer.js";

const parseZoneList = (raw: string): readonly ZoneType[] => {
  const tokens = raw.split(/[,\s]+/).filter((s) => s !== "");
  return tokens.map((t) => t.toLowerCase() as ZoneType);
};

export const parseStaticLine = (line: LexedLine): StaticAst => {
  if (line.prefix !== "S") {
    throw new Error(`parseStaticLine: expected prefix 'S', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  let mode: string | null = null;
  let activeInZones: readonly ZoneType[] = ["battlefield" as ZoneType];
  const params: Record<string, ParamValue> = {};

  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Mode") {
        const canonical = staticAbilityModeFromName(v);
        if (canonical === null) {
          throw new Error(`unknown StaticAbilityMode '${v}' at line ${line.lineNumber}`);
        }
        mode = canonical;
      } else if (k === "EffectZone") {
        activeInZones = parseZoneList(v);
      } else if (k === "Description") {
        // skip — description text is not captured in the AST
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (mode === null) {
    throw new Error(`parseStaticLine: missing Mode$ at line ${line.lineNumber}`);
  }

  return { mode, params, activeInZones };
};

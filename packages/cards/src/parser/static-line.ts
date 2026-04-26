// SPDX-License-Identifier: GPL-3.0-or-later
import {
  type ParamValue,
  type StaticAst,
  type ZoneType,
  staticAbilityModeFromName,
} from "@mtg-forge-ts/core";
import { SVAR_BINDING_PARAMS, classifyParamValue } from "./ability-line.js";
import type { LexedLine } from "./lexer.js";

const parseZoneList = (raw: string): readonly ZoneType[] => {
  const tokens = raw.split(/[,\s]+/).filter((s) => s !== "");
  return tokens.map((t) => t.toLowerCase() as ZoneType);
};

// Parse a single S: line into one or more StaticAst nodes.
// If Mode$ contains a comma-separated list (e.g. "CantAttack,CantBlock"),
// one StaticAst is produced per mode, each sharing the same params and zones.
export const parseStaticLine = (line: LexedLine): readonly StaticAst[] => {
  if (line.prefix !== "S") {
    throw new Error(`parseStaticLine: expected prefix 'S', got '${line.prefix}' at line ${line.lineNumber}`);
  }
  let rawMode: string | null = null;
  let activeInZones: readonly ZoneType[] = ["battlefield" as ZoneType];
  const params: Record<string, ParamValue> = {};

  for (const tok of line.tokens) {
    for (const [k, v] of tok) {
      if (k === "Mode") {
        rawMode = v;
      } else if (k === "EffectZone") {
        activeInZones = parseZoneList(v);
      } else if (k === "Description") {
        // skip — description text is not captured in the AST
      } else if (SVAR_BINDING_PARAMS.has(k)) {
        params[k] = { kind: "literal", raw: v };
      } else {
        params[k] = classifyParamValue(v);
      }
    }
  }

  if (rawMode === null) {
    throw new Error(`parseStaticLine: missing Mode$ at line ${line.lineNumber}`);
  }

  // Support comma-separated Mode$ values (e.g. "CantAttack,CantBlock").
  // Each mode produces a separate StaticAst sharing the same params/zones.
  const modeTokens = rawMode.split(",").map((m) => m.trim());
  const results: StaticAst[] = [];
  for (const modeToken of modeTokens) {
    const canonical = staticAbilityModeFromName(modeToken);
    if (canonical === null) {
      throw new Error(`unknown StaticAbilityMode '${modeToken}' at line ${line.lineNumber}`);
    }
    results.push({ mode: canonical, params, activeInZones });
  }
  return results;
};

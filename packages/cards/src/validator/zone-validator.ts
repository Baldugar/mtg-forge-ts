// SPDX-License-Identifier: GPL-3.0-or-later
import type { CardDefinition, StaticAst } from "@mtg-forge-ts/core";
import { registerValidator } from "./validate-card.js";
import type { ValidationIssue } from "./validate-card.js";

// Valid zone names as emitted by the parser (lowercase via t.toLowerCase() cast).
// Covers all ZoneType enum values (lowercased) plus the "all" sentinel that
// Forge uses for EffectZone$ All (meaning the ability is active in every zone).
const VALID_ZONE_NAMES = new Set([
  "all",
  "ante",
  "attractiondeck",
  "battlefield",
  "command",
  "contraptiondeck",
  "exile",
  "extrahand",
  "flashback",
  "graveyard",
  "hand",
  "junkyard",
  "library",
  "merged",
  "none",
  "planar",
  "planardeck",
  "scheme",
  "schemedeck",
  "sideboard",
  "stack",
  "subgame",
]);

const validateZones = (card: CardDefinition, path: string): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const statics = card.statics as readonly StaticAst[];
  for (let i = 0; i < statics.length; i++) {
    const s = statics[i];
    if (!s) continue;
    for (const zone of s.activeInZones) {
      const name = String(zone).toLowerCase();
      if (!VALID_ZONE_NAMES.has(name)) {
        issues.push({
          severity: "error",
          message: `unknown zone '${String(zone)}' in S:Mode$ ${s.mode}`,
          path: `${path}.statics[${i}].activeInZones`,
        });
      }
    }
  }
  return issues;
};

registerValidator(validateZones);

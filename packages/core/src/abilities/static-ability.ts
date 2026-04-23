// SPDX-License-Identifier: GPL-3.0-or-later
// CR 604 — static ability shape. Tasks 25-28 implement the registry.
import type { AbilityBase } from "./active-ability.js";

export type StaticAbilityCategory =
  | "continuous" // contributes to LayerEngine
  | "costModification" // affects cost solver (SP3 integrates)
  | "cantMustMay" // affects decision validator
  | "replacementGenerating" // registers replacements while active
  | "preventDamage" // damage-prevention shields
  | "ruleChanging" // overrides game rules (e.g. "you don't lose at 0 life")
  | "abilityGranting" // Layer 6 contributor
  | "alternativeCost"; // adds AltCost entries

export interface StaticAbility extends AbilityBase {
  readonly kind: "static";
  readonly category: StaticAbilityCategory;
  // Payload: concrete layer-effect struct, cost-mod descriptor, cant-must-may
  // restriction, etc. Interpretation depends on `category`. SP3 defines the
  // full category-payload matrix; SP2 keeps it `unknown` so the core type
  // remains stable.
  describe(): unknown;
}

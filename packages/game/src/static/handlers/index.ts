// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 baseline + Wave 11 completeness — barrel for static-mode handlers.
// The export-* statements ensure bundlers retain the module-level register()
// side effects that populate staticHandlerRegistry.
//
// Wave 11 closed the SetCost gap (Trinisphere-style "spells cost at least N
// mana"); previously deferred from Wave 6.
// Wave 50 — the static-mode pack adds the 12 highest-card-count restriction
// modes: CantBlockBy / CantAttack / AlternativeCost / CantBlock / CantBeCast
// / MustAttack / CastWithFlash / MinMaxBlocker / OptionalCost / Panharmonicon
// / CantBeActivated / CanAttackDefender (~1700 cards combined). Registry size
// goes from 5 → 17 modes.
export * from "./continuous.js";
export * from "./reduce-cost.js";
export * from "./raise-cost.js";
export * from "./set-cost.js";
// Batch D2 static handlers
export * from "./counters-remain.js";
// Wave 50 — combat-side restrictions
export * from "./cant-block-by.js";
export * from "./cant-block.js";
export * from "./cant-attack.js";
export * from "./must-attack.js";
export * from "./can-attack-defender.js";
export * from "./min-max-blocker.js";
// Wave 50 — cast / activation restrictions
export * from "./cant-be-cast.js";
export * from "./cant-be-activated.js";
export * from "./cast-with-flash.js";
export * from "./alternative-cost.js";
export * from "./optional-cost.js";
// Wave 50 — replacement-generating-shape (Panharmonicon, ruleChanging)
export * from "./panharmonicon.js";
// Wave 60 — three same-shape "cant" gate statics:
//   - CantPutCounter (Solemnity / Hushwood Verge / Phyrexian Unlife)
//   - CantRegenerate (Eldrazi Conscription / Kaervek synergies)
//   - DontUntap (Stasis basic case)
export * from "./cant-put-counter-static.js";
export * from "./cant-regenerate-static.js";
export * from "./dont-untap-static.js";

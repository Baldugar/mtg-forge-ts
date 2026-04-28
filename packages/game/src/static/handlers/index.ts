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
// Wave 60.C — two same-shape "permission gate" statics:
//   - MayBeCastBy (Bolas's Citadel / Oracle of Mul Daya / Sen Triplets /
//     Wishclaw Talisman / Knowledge Pool / Mind's Dilation)
//   - MaxLevel (Class enchantment level cap, CR 716)
export * from "./may-be-cast-by-static.js";
export * from "./max-level-static.js";
// Wave 60.D — two turn-structure modifier statics:
//   - LimitOnHandSize (Reliquary Tower / Spellbook / Library of Leng /
//     Thought Vessel)
//   - AdditionalCombatPhase (Aurelia, the Warleader emblem-shape +
//     companion to AB$ AdditionalCombat used by Aggravated Assault et al.)
export * from "./limit-on-hand-size-static.js";
export * from "./additional-combat-phase-static.js";
// Wave 60.E — three same-shape damage-prevention statics (CR 615):
//   - PreventAllDamage    (global Fog-shape statics — no filter)
//   - PreventAllDamageBy  (filtered source — Holy Day, Story Circle's
//                          color-conditional source variant)
//   - PreventAllDamageTo  (filtered target — Worship-shape protection)
export * from "./prevent-damage-static.js";
// Wave 60.G — three same-shape turn-structure phase-step modifier statics:
//   - SkipUntap            (Stasis / Eon Hub / Curses — skip untap step)
//   - SkipDraw             (The Abyss-style — skip draw step)
//   - AdditionalUntapStep  (Awakening Zone / Time Vault — extra untap step)
export * from "./skip-untap-static.js";
export * from "./skip-draw-static.js";
export * from "./additional-untap-step-static.js";
// Wave 60.H — three same-shape registry-walk gate statics:
//   - CantSearchLibrary  (Mindlock Orb / Stranglehold)
//   - CantSacrifice      (Sigarda / Aegis / Heroic Intervention static form)
//   - CantTransform      (Immerwolf / Day-Night interaction disruptors)
export * from "./cant-search-library-static.js";
export * from "./cant-sacrifice-static.js";
export * from "./cant-transform-static.js";
// Wave 60.I — wrap-up batch: three remaining named modes from the
// Wave 60 roadmap (different shapes, all small):
//   - ManaConvert        (CR 605 — payment-time mana-color rewrite,
//                          Forge's StaticAbilityManaConvert.java; canon.
//                          ManaConversion$ token; ~15-20 cards)
//   - Crew (static form) (CR 702.122 — rare; per-card "is a creature
//                          without crewing" flag stamp; ~5-10 cards)
//   - StartingHandSizeMod (CR 103 — accumulator on Player; ~5 cards)
export * from "./mana-convert-static.js";
export * from "./crew-static.js";
export * from "./starting-hand-size-mod-static.js";

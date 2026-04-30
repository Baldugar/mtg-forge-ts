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
// Wave 70.D — top-three long-tail static modes by Forge corpus
// frequency (already in the enum but until now lacked a registered
// handler):
//   - CantTarget                (~26 cards — True Believer / Mother of
//                                Runes / Spectra Ward / Aether Membrane)
//   - CantAttackUnless          (~25 cards — Propaganda / Ghostly Prison /
//                                Mystic Barrier / Sphere of Resistance)
//   - CombatDamageToughness     (~18 cards — Doran, the Siege Tower /
//                                Assault Formation / Belligerent Brontodon)
export * from "./cant-target-static.js";
export * from "./cant-attack-unless-static.js";
export * from "./combat-damage-toughness-static.js";
// Wave 70.E — three more registry-walk gate statics from the long-tail
// static-mode pack (already in the enum; previously unhandled):
//   - CantGainLife              (~18 cards — Erebos / Sulfuric Vortex /
//                                Roiling Vortex / Stigma Lasher /
//                                Rampaging Ferocidon / Yasharn)
//   - CantPlayLand              (~11 cards — Restorm, the Searing /
//                                Stranglehold / Emberwilde Captain /
//                                Ob Nixilis, the Adversary)
//   - CantPreventDamage         (~10 cards — Comet, Stellar Pup /
//                                Inferno; bypasses Wave 60.E
//                                PreventAllDamage for matched sources)
export * from "./cant-gain-life-static.js";
export * from "./cant-play-land-static.js";
export * from "./cant-prevent-damage-static.js";
// Wave 70.F — three more registry-walk gate statics from the long-tail
// static-mode pack (enum entries previously unhandled):
//   - UntapOtherPlayer              (~15 cards — Awakening / Vedalken
//                                    Orrery analogues / Dramatic
//                                    Reversal-style emblems)
//   - AssignCombatDamageAsUnblocked (~13 cards — Bloodthorn Tine /
//                                    Tempting Wurm / Rogue's Passage
//                                    analogues; routes blocked attacker
//                                    damage to defending player as if
//                                    unblocked)
//   - IgnoreLandwalk                (~10 cards — Sphere of Truth /
//                                    Reverence; blocker can block
//                                    attacker with landwalk)
export * from "./untap-other-player-static.js";
export * from "./assign-combat-damage-as-unblocked-static.js";
export * from "./ignore-land-walk-static.js";

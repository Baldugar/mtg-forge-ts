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
// Wave 70.G — top-three remaining unwired static modes from the
// Forge corpus by frequency:
//   - CanAttackIfHaste     (~28 cards — Glorybringer / Combat Celebrant
//                            / Frenzied Saddlebrute / Instill Energy;
//                            positive override of summoning sickness
//                            for matched attacker + matched defender)
//   - MustBlock            (~27 cards — Provoke / Brutal Hordechief /
//                            Lure-shape statics; auto-correct at
//                            declareBlockers pulls subjects in if able)
//   - AttackVigilance      (~11 cards — Archangel of Tithes / Hipparion
//                            / Hollow Warrior / Heat Wave; attacker
//                            doesn't tap when attacking, vigilance-
//                            equivalent without the keyword stamp)
export * from "./can-attack-if-haste-static.js";
export * from "./must-block-static.js";
export * from "./attack-vigilance-static.js";
// Wave 70.H — three more registry-walk gate statics, picked from the
// Forge corpus by frequency (the largest unwired modes after 70.G):
//   - OptionalAttackCost   (~28 cards — Exert family: Ahn-Crop Champion
//                            / Battlefield Scavenger / Combat Celebrant
//                            / Glorybringer / Vizier of Hazoret /
//                            Champion of Rhonas; "may pay <Cost> as
//                            CARDNAME attacks. If you do, <Trigger>")
//   - AttackRestrict       (~8 cards — Astral Arena / Caverns of
//                            Despair / Crawlspace / Dueling Grounds /
//                            Silent Arbiter / The Eternal Wanderer;
//                            MaxAttackers$ N global combat cap)
//   - BlockRestrict        (~5 cards — Astral Arena / Caverns of
//                            Despair / Dueling Grounds / Silent Arbiter
//                            / Mirri, Weatherlight Duelist;
//                            MaxBlockers$ N global combat cap)
export * from "./optional-attack-cost-static.js";
export * from "./attack-restrict-static.js";
export * from "./block-restrict-static.js";
// Wave 70.I — three more registry-walk gate statics from the long-tail
// static-mode pack (enum entries previously unhandled):
//   - CantDraw                  (~7 cards — Howling Mine inverse / Curse
//                                 of the Forsaken / Black Vise variants;
//                                 matched player's draws no-op silently)
//   - NumLoyaltyAct             (~6 cards — Carth the Lion / The Chain
//                                 Veil / Oath of Teferi; +N additional
//                                 loyalty activations per planeswalker
//                                 per turn over the CR 606.5b default)
//   - NoCleanupDamage           (~7 cards — permanent-damage themed
//                                 creatures; marked damage doesn't
//                                 clear at cleanup, persists across
//                                 turns until cleared by another effect)
export * from "./cant-draw-static.js";
export * from "./num-loyalty-act-static.js";
export * from "./no-cleanup-damage-static.js";
// Wave 70.J — three more registry-walk gate statics from the long-tail
// static-mode pack (next-frequency tier of unwired modes after 70.I):
//   - IgnoreLegendRule          (~10 cards — Mirror Gallery / Sliver
//                                 Legion / Brothers Yamazaki / Spider
//                                 tribal / token doppelgangers /
//                                 commander-only exemptions; CR 704.5j
//                                 override — matched cards skipped by
//                                 the legend-rule SBA collector)
//   - CantBlockUnless           (~9 cards — Aurochs Herd shape /
//                                 Crawlspace siblings / Vampiric Link
//                                 aura / power-3+ guardrails / "tap
//                                 creature" cost variants. Mirror of
//                                 CantAttackUnless on the block side)
//   - DisableTriggers           (~8 cards — Hushwing Gryff / Tocatli
//                                 Honor Guard / Torpor Orb / Hushbringer
//                                 / Cursed Totem-shape emblem / Permanent
//                                 .OppCtrl scoped variants; suppresses
//                                 trigger fires whose cause/mode/zone
//                                 transitions match the static)
export * from "./ignore-legend-rule-static.js";
export * from "./cant-block-unless-static.js";
export * from "./disable-triggers-static.js";
// Wave 70.K — three more registry-walk gate statics:
//   - CantAttach           (~7 cards — Sigarda / True Believer /
//                            Witchbane Orb / attach-time hexproof
//                            analogues / Story Circle attach siblings)
//   - AttackRequirement    (~4 cards — Goad-with-target-restriction /
//                            curse-shape "creatures attack you if able"
//                            / Vow auras / Marisi-shape goading)
//   - IgnoreHexproof       (~3 cards — Glaring Spotlight / Arcane
//                            Lighthouse / Beast Within analogues /
//                            Obeka-shape carve-outs)
export * from "./cant-attach-static.js";
export * from "./attack-requirement-static.js";
export * from "./ignore-hexproof-static.js";
// Wave 70.L — three more long-tail static modes (small but exact card
// impact; previously enum-only without a registered handler):
//   - CantPayLife                  (~3 cards — Angel of Jubilation /
//                                    Karn's Sylex / Yasharn, Implacable
//                                    Earth; gates life-payment as part
//                                    of casting / activating)
//   - MustTarget                   (~3 cards — Coalition Flag /
//                                    Coalition Honor Guard / Standard
//                                    Bearer; the Flagbearer mechanic —
//                                    opponents must target a Flagbearer
//                                    if able)
//   - ActivateAbilityAsIfHaste     (~3 cards — Dynaheir, Invoker Adept /
//                                    Thousand-Year Elixir / Tyvar,
//                                    Jubilant Brawler; bypass summoning
//                                    sickness for activated-ability
//                                    tap costs)
export * from "./cant-pay-life-static.js";
export * from "./must-target-static.js";
export * from "./activate-ability-as-if-haste-static.js";
// Wave 70.M — four more long-tail static modes (small but exact card
// impact; previously enum-only without a registered handler):
//   - PlayerMustAttack             (~2 cards — Seeker of Slaanesh /
//                                    Trove of Temptation; the matched
//                                    player must attack with at least
//                                    one creature each combat if able)
//   - CantBeCopied                 (~2 cards — Display of Power / See
//                                    Double; "this spell can't be
//                                    copied" — Stack.copy rejects)
//   - MaxCounter                   (~1 card — Rasputin Dreamweaver;
//                                    caps counter accumulation by
//                                    counter type via clamp at
//                                    addCounter)
//   - CantLoseLife                 (~2 cards — Courageous Resolve /
//                                    Everybody Lives!; mirror of
//                                    CantGainLife on the negative-
//                                    delta side — clamps changeLife
//                                    losses to 0)
export * from "./player-must-attack-static.js";
export * from "./cant-be-copied-static.js";
export * from "./max-counter-static.js";
export * from "./cant-lose-life-static.js";
// Wave 70.N — highest-frequency remaining unwired static mode:
//   - AssignNoCombatDamage         (~26 cards — Sunhome Enforcer style
//                                    "deals no combat damage", Indomitable
//                                    Ancients defender forms, "cannot
//                                    deal damage" curses; same shape as
//                                    Wave 70.D CombatDamageToughness but
//                                    forces 0 damage regardless of power)
export * from "./assign-no-combat-damage-static.js";

// SPDX-License-Identifier: GPL-3.0-or-later
// Side-effect imports — loading this file populates the effect registry.
// Export * ensures bundlers include the module-level register() side effects
// even when tree-shaking is enabled.
export * from "./deal-damage.js";
export * from "./draw.js";
export * from "./destroy.js";
export * from "./gain-life.js";
export * from "./lose-life.js";
export * from "./exile.js";
export * from "./return-to-hand.js";
export * from "./change-zone.js";
export * from "./sacrifice.js";
export * from "./tap.js";
export * from "./untap.js";
export * from "./mill.js";
export * from "./scry.js";
export * from "./put-counter.js";
export * from "./remove-counter.js";
export * from "./discard.js";
export * from "./token.js";
export * from "./pump.js";
export * from "./counter-spell.js";
export * from "./attach.js";
export * from "./fight.js";
export * from "./animate.js";
export * from "./pump-all.js";
// Part D Wave 4 — 5 high-impact effects from corpus scan
export * from "./mana.js";
export * from "./destroy-all.js";
export * from "./damage-all.js";
export * from "./regenerate.js";
export * from "./change-zone-all.js";
// Part D Wave 5 — modal dispatcher, meta-wrapper, and library lookup
export * from "./charm.js";
export * from "./effect.js";
export * from "./dig.js";
// Wave 6 — control, prevention, card selection, copy
export * from "./gain-control.js";
export * from "./prevent-damage.js";
export * from "./choose-card.js";
export * from "./copy-permanent.js";
// Wave 7 — SetState (DFC transform!), PutCounterAll, ChooseSource
export * from "./set-state.js";
export * from "./put-counter-all.js";
export * from "./choose-source.js";
// Wave 8b effects
export * from "./animate-all.js";
export * from "./choose-color.js";
export * from "./play.js";
export * from "./repeat-each.js";
export * from "./peek-and-reveal.js";
// Wave 9 effects
export * from "./protection.js";
export * from "./roll-dice.js";
export * from "./untap-all.js";
export * from "./tap-all.js";
// Wave 10 effects
export * from "./reveal-hand.js";
export * from "./choose-type.js";
export * from "./branch.js";
export * from "./flip-a-coin.js";
export * from "./surveil.js";
// Wave 15 — corpus-unknown effects (20 handlers)
export * from "./add-turn.js";
export * from "./fog.js";
export * from "./reveal.js";
export * from "./set-life.js";
export * from "./name-card.js";
export * from "./choose-player.js";
export * from "./generic-choice.js";
export * from "./debuff.js";
export * from "./change-text.js";
export * from "./make-card.js";
export * from "./permanent-creature.js";
export * from "./dig-until.js";
export * from "./delayed-trigger.js";
export * from "./repeat.js";
export * from "./move-counter.js";
export * from "./copy-spell-ability.js";
export * from "./amass.js";
export * from "./seek.js";
export * from "./mana-reflected.js";
export * from "./assemble-contraption.js";
// Wave 18 — corpus unknown effects (20 handlers)
export * from "./wave-18-effects.js";
// Wave 19 — final corpus unknown effects (15 handlers)
export * from "./wave-19-effects.js";
// Wave 21 — corpus long-tail effects (20 handlers)
export * from "./wave-21-effects.js";
// Wave 22 — final corpus long-tail effects (20 handlers)
export * from "./wave-22-effects.js";
// SP3 — Specialize keyword resolver (March of the Machine, 47 cards).
// Synthesized by SpecializeKeywordHandler; registered as handlerKey "Specialize".
export * from "./specialize.js";
// SP3 — Plot keyword resolver (Bloomburrow / CR 718). Synthesized by
// PlotKeywordHandler; registered as handlerKey "Plot".
export * from "./plot.js";
// Wave 24 — Crew (Kaladesh / CR 702.121) and Saddle (Outlaws of Thunder
// Junction / CR 702.165) keyword resolvers. Synthesized by their respective
// keyword handlers; registered as handlerKey "Crew" / "Saddle".
export * from "./crew.js";
export * from "./saddle.js";
// Wave 28 — Station (Aetherdrift / CR 718). Synthesized by
// StationKeywordHandler; mirrors Crew with type-flip to Creature.
export * from "./station.js";
// Wave 28 — VisitAttraction (Unfinity). Emits AttractionVisited so
// VisitAttractionTrigger (Wave 22) fires.
export * from "./visit-attraction.js";
// Wave 28 — Forage (Bloomburrow). Standalone effect emit — the matching
// cost-part lives in cost/parts/cost-forage.ts and emits the same event
// when paid.
export * from "./forage.js";
// Wave 26 — Suspend special-action resolver (Time Spiral / CR 702.61).
// Synthesized by SuspendKeywordHandler; registered as handlerKey "Suspend".
export * from "./suspend.js";
// Wave 29 — Adapt activated-ability resolver (CR 702.139).
export * from "./adapt.js";
// Wave 30 — Ninjutsu activated-ability resolver (CR 702.49).
export * from "./ninjutsu.js";
// Wave 33 — Embalm / Eternalize activated-ability resolvers
// (CR 702.131 / 702.139). Each spawns a token copy of the source via
// game.action.createToken and stamps tokenOverrides for color / type / P-T
// / mana-cost overrides applied by deriveBaseCharacteristics.
export * from "./embalm.js";
export * from "./eternalize.js";
// Wave 38 — Channel / Transmute / Reinforce / Scavenge resolvers
// (CR 702.74 / 702.49 / 702.76 / 702.95). Hand- and graveyard-activated
// abilities synthesized by their respective keyword handlers.
export * from "./channel.js";
export * from "./transmute.js";
export * from "./reinforce.js";
export * from "./scavenge.js";
// Wave 55 — TurnFaceUp resolver (CR 702.36 / 702.94 / 702.166).
// Synthesized by Morph/Megamorph/Disguise keyword handlers; flips the
// face-down card via the existing turn-face-up primitive and (for
// megamorph) adds a +1/+1 counter post-flip.
export * from "./turn-face-up.js";
// Wave 56 — ReplaceEffect family. Six sub-effects used INSIDE replacement
// bodies via `ReplaceWith$ <SVar>` dispatch. They mutate the in-flight
// intent through the `game.flags.activeReplacementIntent` side channel
// rather than executing standalone game-state changes.
export * from "./replace-effect.js";
// Wave 60.D — AdditionalCombat effect (Aggravated Assault / Relentless
// Assault / Hellkite Charger / Combat Celebrant / Savage Beating /
// Seize the Day). Bumps the per-seat pendingAdditionalCombatPhases
// counter; phase handler consumes one at end-of-combat and injects an
// extra combat block via PhaseSequence.injectExtraCombat.
export * from "./additional-combat.js";
// Wave 61.F — Encore activated-ability resolver (CR 702.143).
// Synthesized by EncoreKeywordHandler; per-opponent token-copy spawn
// tapped + attacking that opponent + haste, with EOT-sac stamp.
export * from "./encore.js";
// Wave 71 — Suspect / CeaseBeingSuspected (CR 701.58, Murders at Karlov
// Manor). Thin wrappers around the same flag-flip the Wave 21
// AlterAttributeEffect performs for `Attributes$ Suspected`.
export * from "./suspect.js";

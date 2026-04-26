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

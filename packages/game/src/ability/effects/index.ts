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

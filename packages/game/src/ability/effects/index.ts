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

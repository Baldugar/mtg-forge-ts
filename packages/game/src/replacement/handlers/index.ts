// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap — importing this file registers all concrete ReplacementHandler
// subclasses with replacementHandlerRegistry. Export * ensures bundlers include
// the module-level register() side effects even when tree-shaking.
export * from "./moved-replacement.js";
export * from "./damage-replacement.js";
// Wave 8b replacements
export * from "./counter-replacement.js";
export * from "./create-token-replacement.js";
export * from "./add-counter-replacement.js";
export * from "./draw-replacement.js";
// Wave 9 replacements
export * from "./untap-replacement.js";
export * from "./gain-life-replacement.js";
export * from "./life-reduced-replacement.js";
// Wave 10 replacements
export * from "./turn-face-up-replacement.js";
export * from "./game-win-replacement.js";
export * from "./game-loss-replacement.js";
// Batch D2 replacements
export * from "./remove-counter-replacement.js";
// Wave 17 replacements — corpus unknown event kinds
export * from "./draw-cards-replacement.js";
export * from "./pay-life-replacement.js";
export * from "./cascade-replacement.js";
export * from "./roll-dice-replacement.js";
export * from "./mill-replacement.js";
export * from "./destroy-replacement.js";
// Wave 19 — final corpus unknown replacement (BeginPhase)
export * from "./begin-phase-replacement.js";
// Wave 20 — long-tail corpus replacements (13 handlers)
export * from "./wave-20-replacements.js";

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

// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./spell-ability-effect.js";
export * from "./effect-registry.js";
export * from "./spell-ability.js";
export * from "./evaluate-param.js";
// Side-effect: populate the effect registry with all flagship effects.
import "./effects/index.js";

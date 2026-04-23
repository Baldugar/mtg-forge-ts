// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface of @mtg-forge-ts/core. Each re-export is a milestone-owned
// module; downstream packages should import from this barrel rather than
// deep-importing so we can refactor internals without breaking consumers.
export const CORE_VERSION = "0.0.0";
export * from "./ids.js";
export * from "./color.js";
export * from "./zone.js";
export * from "./phase.js";
export * from "./counter-type.js";
export * from "./mana/index.js";
export * from "./cost/index.js";
export * from "./card/index.js";
export * from "./characteristics/index.js";
export * from "./deck/index.js";
export * from "./rng/index.js";
export * from "./errors.js";
export * from "./log/index.js";
export * from "./effects/index.js";
export * from "./events/index.js";
export * from "./decisions/index.js";
export * from "./views/index.js";
export * from "./dsl/index.js";
export * from "./image/index.js";
export * from "./format/index.js";
export * from "./lobby-player.js";
export * from "./abilities/index.js";

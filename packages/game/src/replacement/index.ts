// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface for the replacement handler framework (SP3 Part F).
// Note: packages/game/src/replacements/ (plural) is the existing SP2 runtime
// (ReplacementRegistry, apply-loop, etc.) — this directory (singular) is the
// new AST → ReplacementAbility construction layer.
export type { ReplacementBuildContext } from "./replacement-handler.js";
export { ReplacementHandler } from "./replacement-handler.js";
export type { ReplacementHandlerCtor } from "./replacement-handler-registry.js";
export { replacementHandlerRegistry } from "./replacement-handler-registry.js";
// Re-export all concrete replacement handler classes — this ensures the bundler
// includes the module-level register() calls that populate replacementHandlerRegistry.
export * from "./handlers/index.js";

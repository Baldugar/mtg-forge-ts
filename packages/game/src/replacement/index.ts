// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface for the replacement handler framework (SP3 Part F).
// Note: packages/game/src/replacements/ (plural) is the existing SP2 runtime
// (ReplacementRegistry, apply-loop, etc.) — this directory (singular) is the
// new AST → ReplacementAbility construction layer.
export type { ReplacementBuildContext } from "./replacement-handler.js";
export { ReplacementHandler } from "./replacement-handler.js";
export type { ReplacementHandlerCtor } from "./replacement-handler-registry.js";
export { replacementHandlerRegistry } from "./replacement-handler-registry.js";
// Side-effect: populate replacementHandlerRegistry with all built-in handlers.
import "./handlers/index.js";

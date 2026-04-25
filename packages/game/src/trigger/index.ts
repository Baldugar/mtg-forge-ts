// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface for the trigger handler framework (SP3 Part E).
// Note: packages/game/src/triggers/ (plural) is the existing SP2 runtime
// (TriggerRegistry, PendingTrigger, etc.) — this directory (singular) is the
// new AST → TriggeredAbility construction layer.
export type { TriggerBuildContext } from "./trigger-handler.js";
export { TriggerHandler } from "./trigger-handler.js";
export type { TriggerHandlerCtor } from "./trigger-handler-registry.js";
export { triggerHandlerRegistry } from "./trigger-handler-registry.js";
// Re-export all concrete trigger handler classes — this ensures the bundler
// includes the module-level register() calls that populate triggerHandlerRegistry.
export * from "./handlers/index.js";

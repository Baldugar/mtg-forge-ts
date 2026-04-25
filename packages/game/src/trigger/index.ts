// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface for the trigger handler framework (SP3 Part E).
// Note: packages/game/src/triggers/ (plural) is the existing SP2 runtime
// (TriggerRegistry, PendingTrigger, etc.) — this directory (singular) is the
// new AST → TriggeredAbility construction layer.
export type { TriggerBuildContext } from "./trigger-handler.js";
export { TriggerHandler } from "./trigger-handler.js";
export type { TriggerHandlerCtor } from "./trigger-handler-registry.js";
export { triggerHandlerRegistry } from "./trigger-handler-registry.js";
// Side-effect: populate triggerHandlerRegistry with all built-in handlers.
import "./handlers/index.js";

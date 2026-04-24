// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./generic-registry.js";
// NOTE: SP1 trigger-registry stub removed in SP2 Task 20 — superseded by
// packages/game/src/triggers/trigger-registry.ts (real CR 603 impl).
// NOTE: SP1 replacement-registry stub removed in SP2 Task 16 — superseded by
// packages/game/src/replacements/replacement-registry.ts (real CR 614 impl).
export * from "./static-effect-registry.js";
export * from "./effect-registry.js";
export * from "./keyword-registry.js";
export * from "./alt-cost-registry.js";
export * from "./rule-override-registry.js";

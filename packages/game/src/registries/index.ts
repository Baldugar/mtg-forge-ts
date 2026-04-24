// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./generic-registry.js";
// NOTE: SP1 trigger-registry stub removed in SP2 Task 20 — superseded by
// packages/game/src/triggers/trigger-registry.ts (real CR 603 impl).
// NOTE: SP1 replacement-registry stub removed in SP2 Task 16 — superseded by
// packages/game/src/replacements/replacement-registry.ts (real CR 614 impl).
// NOTE: SP1 static-effect-registry stub removed in SP2 Task 25 — superseded
// by packages/game/src/statics/static-effect-registry.ts (real CR 604 impl).
// NOTE: SP1 effect-registry shell stub removed in SP3 Part C Task 50 —
// superseded by packages/game/src/ability/effect-registry.ts (real M6 impl).
export * from "./keyword-registry.js";
export * from "./alt-cost-registry.js";
export * from "./rule-override-registry.js";

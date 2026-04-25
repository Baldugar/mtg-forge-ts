// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap — importing this file registers all concrete TriggerHandler
// subclasses with triggerHandlerRegistry. Export * ensures bundlers include
// the module-level register() side effects even when tree-shaking.
export * from "./attacks-trigger.js";
export * from "./changes-zone-trigger.js";
export * from "./dealt-damage-trigger.js";
export * from "./phase-trigger.js";
export * from "./spell-cast-trigger.js";
// Wave 6 triggers
export * from "./attackers-declared-trigger.js";
export * from "./blocks-trigger.js";
// Wave 7 triggers
export * from "./attacker-blocked-trigger.js";
export * from "./attacker-blocked-by-creature-trigger.js";
export * from "./turn-face-up-trigger.js";

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
// Wave 8b triggers
export * from "./changes-zone-all-trigger.js";
export * from "./sacrificed-trigger.js";
export * from "./discarded-trigger.js";
export * from "./life-gained-trigger.js";
export * from "./becomes-target-trigger.js";
// Wave 9 triggers
export * from "./damage-done-once-trigger.js";
export * from "./chaos-ensues-trigger.js";
export * from "./set-in-motion-trigger.js";
export * from "./taps-trigger.js";
export * from "./transformed-trigger.js";
// Wave 10 triggers
export * from "./counter-added-once-trigger.js";
export * from "./ability-cast-trigger.js";
export * from "./cycled-trigger.js";
export * from "./always-trigger.js";
export * from "./drawn-trigger.js";
// Wave 16 triggers — corpus unknown trigger modes
export * from "./crank-contraption-trigger.js";
export * from "./planeswalked-to-trigger.js";
export * from "./mutates-trigger.js";
export * from "./attackers-declared-one-target-trigger.js";
export * from "./taps-for-mana-trigger.js";
export * from "./attached-trigger.js";
export * from "./rolled-die-trigger.js";
export * from "./mana-expend-trigger.js";
export * from "./land-played-trigger.js";
export * from "./attacker-unblocked-trigger.js";
export * from "./untaps-trigger.js";
export * from "./counter-player-added-all-trigger.js";
export * from "./turn-begin-trigger.js";
export * from "./spell-cast-or-copy-trigger.js";
export * from "./scry-trigger.js";
export * from "./commit-crime-trigger.js";
export * from "./counter-removed-trigger.js";
export * from "./become-monstrous-trigger.js";
export * from "./ring-tempts-you-trigger.js";
// Wave 18 — corpus unknown triggers (12 handlers)
export * from "./wave-18-triggers.js";
// Wave 19 — final corpus unknown triggers (20 handlers)
export * from "./wave-19-triggers.js";
// Wave 20 — corpus long-tail triggers (20 handlers)
export * from "./wave-20-triggers.js";
// Wave 21 — corpus long-tail triggers (20 handlers)
export * from "./wave-21-triggers.js";
// Wave 22 — final corpus long-tail triggers (14 handlers)
export * from "./wave-22-triggers.js";

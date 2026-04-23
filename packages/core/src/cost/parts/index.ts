// SPDX-License-Identifier: GPL-3.0-or-later
// Barrel for the 40 concrete CostPart classes ported from Forge's
// forge-game/src/main/java/forge/game/cost/ directory. Re-exporting every
// module here ensures each file's `CostPartRegistry.register(...)` call fires
// at module load, so `Cost.fromJSON` can resolve any registered kind.
export * from "./add-mana.js";
export * from "./behold.js";
export * from "./behold-exile.js";
export * from "./blight.js";
export * from "./choose-color.js";
export * from "./choose-creature-type.js";
export * from "./collect-evidence.js";
export * from "./damage.js";
export * from "./discard.js";
export * from "./draw.js";
export * from "./enlist.js";
export * from "./exert.js";
export * from "./exile.js";
export * from "./exiled-move-to-grave.js";
export * from "./exile-from-stack.js";
export * from "./flip-coin.js";
export * from "./forage.js";
export * from "./gain-control.js";
export * from "./gain-life.js";
export * from "./mana.js";
export * from "./mill.js";
export * from "./pay-energy.js";
export * from "./pay-life.js";
export * from "./pay-shards.js";
export * from "./promise-gift.js";
export * from "./put-card-to-lib.js";
export * from "./put-counter.js";
export * from "./remove-any-counter.js";
export * from "./remove-counter.js";
export * from "./return.js";
export * from "./reveal.js";
export * from "./reveal-chosen.js";
export * from "./roll-dice.js";
export * from "./sacrifice.js";
export * from "./tap.js";
export * from "./tap-type.js";
export * from "./unattach.js";
export * from "./untap.js";
export * from "./untap-type.js";
export * from "./waterbend.js";

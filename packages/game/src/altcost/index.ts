// SPDX-License-Identifier: GPL-3.0-or-later
// Side-effect barrel: importing this module registers all AltCost handlers
// into the altCostRegistry singleton.
export * from "./bestow.js";
export * from "./disturb.js";
export * from "./flashback.js";
export * from "./foretell.js";
export * from "./madness.js";
export * from "./mutate.js";
export * from "./overload.js";
export * from "./plot.js";
export * from "./suspend.js";
// Wave 33 — Aftermath (graveyard-cast, exile-after-resolve for split R-half).
export * from "./aftermath.js";

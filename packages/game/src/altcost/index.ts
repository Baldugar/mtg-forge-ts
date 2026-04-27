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
// Wave 37 — Splice onto Arcane (CR 702.46/702.47). Hand-zone alt-cost
// stamp; full graft of effects onto the in-flight Arcane spell is
// deferred (TODO(advanced)).
export * from "./splice.js";
// Wave 38 — Retrace (Eventide, CR 702.81). Graveyard-cast alt-cost
// without printed-mana-cost replacement; the additional Discard-a-Land
// cost is documented under TODO(advanced).
export * from "./retrace.js";
// Wave 55 — Adventure (CR 715) and Jump-Start (CR 702.139).
//   Adventure: cast-from-Exile of the creature half after the Adventure
//     half resolves and exiles the card. Overrides the default exile-
//     origin → exile-on-resolve to Battlefield.
//   Jump-Start: cast-from-Graveyard with an additional Discard cost,
//     post-resolution → Exile (mirrors Flashback). The additional
//     discard cost wiring is documented under TODO(advanced).
export * from "./adventure.js";
export * from "./jump-start.js";
// Wave 57 — Buyback (CR 702.26). Additional optional cost paid at cast
// time; on resolution, the card returns to its owner's hand instead of
// the graveyard. The MVP routes through AltCost so the keyword stamps
// and the post-resolution destination override is observable; the
// "additional cost" wiring in stepDetermineTotalCost is documented under
// TODO(advanced) in altcost/buyback.ts.
export * from "./buyback.js";
// Wave 58 — Warp, Blitz, Surge, Emerge, Miracle. Each is a Hand-zone
// alt-cost stamping altCostUsed + replacing totalCost.base; per-keyword
// post-resolve / availability checks live in the AltCost module.
export * from "./warp.js";
export * from "./blitz.js";
export * from "./surge.js";
export * from "./emerge.js";
export * from "./miracle.js";

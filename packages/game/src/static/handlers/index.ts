// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — barrel for static-mode handlers. The export-* statements ensure
// bundlers retain the module-level register() side effects that populate
// staticHandlerRegistry.
//
// SetCost is intentionally deferred: its semantics are "this spell costs
// exactly X" (replacing the entire mana cost), which differs structurally
// from RaiseCost/ReduceCost's additive delta and needs richer plumbing
// through the cost solver.
export * from "./continuous.js";
export * from "./reduce-cost.js";
export * from "./raise-cost.js";

// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.23 — Rampage N. Whenever a creature with Rampage N becomes blocked
// by 2+ creatures, it gets +N/+N until end of turn for each blocker beyond
// the first. SP2 exposes the math; SP3 wires the actual Layer 7c effect
// registration when blockers are declared (Milestone J trigger path).
//
// Example: a creature with Rampage 2 blocked by 3 creatures gets +4/+4
// (2 per blocker beyond the first × 2 extra blockers).

/**
 * Bonus P/T for a Rampage-N creature blocked by `blockerCount` creatures.
 * Returns 0 when blockerCount is 0 or 1 (no bonus — rampage only triggers
 * on 2+ blockers). Rejects negative N defensively (clamped to 0).
 */
export const computeRampageBonus = (rampageN: number, blockerCount: number): number => {
  if (rampageN <= 0) return 0;
  if (blockerCount <= 1) return 0;
  return rampageN * (blockerCount - 1);
};

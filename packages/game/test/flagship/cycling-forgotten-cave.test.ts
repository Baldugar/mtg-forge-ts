// SPDX-License-Identifier: GPL-3.0-or-later
// F13 — Cycling flagship test (Forgotten Cave or any cycling card).
//
// STATUS: SKIPPED — Part G2 gap.
//
// Cycling is a keyword ability that must be activated from the HAND zone:
//   {cost}, Discard this card: Draw a card.
//
// Implementing Cycling requires:
//
//   1. A CyclingKeywordHandler that generates a synthetic SpellAbility on the
//      card (with cost "<cycling-cost>, Discard CARDNAME" and effect "Draw 1").
//
//   2. The existing activateAbility orchestrator hardcodes `card.zone ===
//      Battlefield` (packages/game/src/ability/activate.ts line 54). Cycling
//      is activated from the Hand. Either a new zone-flexible activator or a
//      separate cycling-specific activation path is needed.
//
//   3. The cost parser must handle "Discard CARDNAME" as a cost part (a
//      CostDiscard that moves the source card to graveyard before the ability
//      resolves). This cost part does not exist in cost/parts/ today.
//
//   4. The CycledTrigger handler (trigger/handlers/cycled-trigger.ts) exists
//      but is wired to a "Cycled" event that nothing emits yet — no cycling
//      pathway produces it.
//
// Scope of work: approximately 3 new files (CyclingKeywordHandler,
// CostDiscard, cycling-specific activation path) + updates to activate.ts and
// keyword/handlers/index.ts + test. Estimated effort: > 60 lines of new engine
// code. Deferred to Part G2 (activated/keyword frameworks).
//
// This file intentionally contains no test assertions. The skip comment acts
// as a precise gap report for the planning queue.

import { describe, it } from "vitest";

describe("Flagship: Cycling — Forgotten Cave (SKIPPED — Part G2 gap)", () => {
  it.todo(
    "cycle Forgotten Cave: {1}, Discard Forgotten Cave → draw a card " +
      "(blocked by: Hand-zone activation, CostDiscard part, CyclingKeywordHandler — all Part G2)",
  );
});

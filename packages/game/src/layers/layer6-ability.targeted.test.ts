// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone K Task 43 — scoped Layer 6 effects via `targetCardId`.
//
// The applier filter step is the mechanism that makes per-attachment
// ability grants possible: a single shared Layer 6 effect array holds
// effects for every card in the game, and only entries whose
// `targetCardId` matches the card being computed apply.
//
// Baseline Task 8 semantics (undefined targetCardId) remain unchanged —
// verified via the unchanged layer6-ability.test.ts file.
import { emptyCharacteristics, mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { applyLayer6Ability } from "./layer6-ability.js";

describe("Layer 6 targeted effects (SP2 Task 43)", () => {
  it("targetCardId matches → effect applies", () => {
    const c = emptyCharacteristics();
    applyLayer6Ability(c, mkEntityId(42), [
      {
        kind: "add",
        abilityId: mkEntityId(1),
        grantedBy: mkEntityId(99),
        origin: "aura",
        timestamp: 1,
        targetCardId: mkEntityId(42),
      },
    ]);
    expect(c.abilities).toHaveLength(1);
    expect(c.abilities[0]?.id).toBe(mkEntityId(1));
  });

  it("targetCardId mismatches → effect skipped", () => {
    const c = emptyCharacteristics();
    applyLayer6Ability(c, mkEntityId(42), [
      {
        kind: "add",
        abilityId: mkEntityId(1),
        grantedBy: mkEntityId(99),
        origin: "aura",
        timestamp: 1,
        targetCardId: mkEntityId(7), // NOT 42
      },
    ]);
    expect(c.abilities).toHaveLength(0);
  });

  it("undefined targetCardId → effect applies to any target (unchanged baseline)", () => {
    const c = emptyCharacteristics();
    applyLayer6Ability(c, mkEntityId(42), [
      {
        kind: "add",
        abilityId: mkEntityId(1),
        grantedBy: mkEntityId(99),
        origin: "layer6",
        timestamp: 1,
      },
    ]);
    expect(c.abilities).toHaveLength(1);
  });

  it("mix of scoped and global effects — only matching scoped + all globals apply", () => {
    const c = emptyCharacteristics();
    applyLayer6Ability(c, mkEntityId(5), [
      {
        kind: "add",
        abilityId: mkEntityId(10),
        grantedBy: mkEntityId(1),
        origin: "layer6",
        timestamp: 1,
        targetCardId: mkEntityId(5),
      },
      {
        kind: "add",
        abilityId: mkEntityId(11),
        grantedBy: mkEntityId(2),
        origin: "layer6",
        timestamp: 2,
        targetCardId: mkEntityId(99), // different card
      },
      {
        kind: "add",
        abilityId: mkEntityId(12),
        grantedBy: mkEntityId(3),
        origin: "layer6",
        timestamp: 3,
        // global (undefined targetCardId)
      },
    ]);
    expect(c.abilities.map((a) => a.id)).toEqual([mkEntityId(10), mkEntityId(12)]);
  });

  it("loseAll with targetCardId strips abilities only on that card", () => {
    const c = emptyCharacteristics();
    c.abilities.push({ id: mkEntityId(1), grantedBy: null, origin: "intrinsic" });
    applyLayer6Ability(c, mkEntityId(5), [{ kind: "loseAll", timestamp: 1, targetCardId: mkEntityId(99) }]);
    // Not this card's id — effect skipped.
    expect(c.abilities).toHaveLength(1);
    const d = emptyCharacteristics();
    d.abilities.push({ id: mkEntityId(1), grantedBy: null, origin: "intrinsic" });
    applyLayer6Ability(d, mkEntityId(5), [{ kind: "loseAll", timestamp: 1, targetCardId: mkEntityId(5) }]);
    expect(d.abilities).toHaveLength(0);
  });
});

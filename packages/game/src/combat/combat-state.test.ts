// SPDX-License-Identifier: GPL-3.0-or-later
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { combatStateToJSON, createCombatState } from "./combat-state.js";

describe("createCombatState", () => {
  it("returns fresh empty maps and firstStrikeSplitActive=false", () => {
    const s = createCombatState();
    expect(s.attackers).toBeInstanceOf(Map);
    expect(s.attackers.size).toBe(0);
    expect(s.blockers).toBeInstanceOf(Map);
    expect(s.blockers.size).toBe(0);
    expect(s.blockerOrdering).toBeInstanceOf(Map);
    expect(s.blockerOrdering.size).toBe(0);
    expect(s.damageAssignments).toBeInstanceOf(Map);
    expect(s.damageAssignments.size).toBe(0);
    expect(s.firstStrikeSplitActive).toBe(false);
  });

  it("returns independent state per instance (mutating one does not affect the other)", () => {
    const a = createCombatState();
    const b = createCombatState();
    a.attackers.set(mkEntityId(1), {
      attackerId: mkEntityId(1),
      defender: { kind: "player", seat: mkPlayerSeat(0) },
      isTapped: false,
    });
    a.firstStrikeSplitActive = true;
    expect(b.attackers.size).toBe(0);
    expect(b.firstStrikeSplitActive).toBe(false);
  });
});

describe("combatStateToJSON", () => {
  it("serialises to a plain object with array-form map entries and the flag", () => {
    const s = createCombatState();
    s.attackers.set(mkEntityId(1), {
      attackerId: mkEntityId(1),
      defender: { kind: "player", seat: mkPlayerSeat(0) },
      isTapped: false,
    });
    s.blockers.set(mkEntityId(2), { blockerId: mkEntityId(2), attackerIds: [mkEntityId(1)] });
    s.blockerOrdering.set(mkEntityId(1), [mkEntityId(2)]);
    s.damageAssignments.set(mkEntityId(1), [{ targetId: mkEntityId(2), amount: 3 }]);
    s.firstStrikeSplitActive = true;

    const json = combatStateToJSON(s) as {
      attackers: unknown[];
      blockers: unknown[];
      blockerOrdering: unknown[];
      damageAssignments: unknown[];
      firstStrikeSplitActive: boolean;
    };
    expect(json.attackers).toHaveLength(1);
    expect(json.blockers).toHaveLength(1);
    expect(json.blockerOrdering).toHaveLength(1);
    expect(json.damageAssignments).toHaveLength(1);
    expect(json.firstStrikeSplitActive).toBe(true);
  });
});

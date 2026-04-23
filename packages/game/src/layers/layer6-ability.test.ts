// SPDX-License-Identifier: GPL-3.0-or-later
import { emptyCharacteristics, mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { applyLayer6Ability } from "./layer6-ability.js";

describe("Layer 6 — Ability add/remove (CR 613.1f)", () => {
  it("add appends an ability ref", () => {
    const c = emptyCharacteristics();
    applyLayer6Ability(c, [
      { kind: "add", abilityId: mkEntityId(7), grantedBy: mkEntityId(1), origin: "layer6", timestamp: 1 },
    ]);
    expect(c.abilities).toHaveLength(1);
    expect(c.abilities[0]?.id).toBe(mkEntityId(7));
    expect(c.abilities[0]?.origin).toBe("layer6");
  });

  it("removeAll deletes refs by grantedBy", () => {
    const c = emptyCharacteristics();
    c.abilities.push({ id: mkEntityId(5), grantedBy: mkEntityId(1), origin: "layer6" });
    c.abilities.push({ id: mkEntityId(6), grantedBy: mkEntityId(2), origin: "layer6" });
    applyLayer6Ability(c, [{ kind: "removeAll", grantedBy: mkEntityId(1), timestamp: 1 }]);
    expect(c.abilities).toHaveLength(1);
    expect(c.abilities[0]?.grantedBy).toBe(mkEntityId(2));
  });

  it("loseAll strips everything (including intrinsic)", () => {
    const c = emptyCharacteristics();
    c.abilities.push({ id: mkEntityId(1), grantedBy: null, origin: "intrinsic" });
    c.abilities.push({ id: mkEntityId(2), grantedBy: mkEntityId(9), origin: "aura" });
    applyLayer6Ability(c, [{ kind: "loseAll", timestamp: 1 }]);
    expect(c.abilities).toHaveLength(0);
  });

  it("loseAll at earlier ts then add at later ts leaves only the added ref", () => {
    const c = emptyCharacteristics();
    c.abilities.push({ id: mkEntityId(1), grantedBy: null, origin: "intrinsic" });
    applyLayer6Ability(c, [
      { kind: "loseAll", timestamp: 1 },
      { kind: "add", abilityId: mkEntityId(2), grantedBy: mkEntityId(8), origin: "layer6", timestamp: 2 },
    ]);
    expect(c.abilities.map((a) => a.id)).toEqual([mkEntityId(2)]);
  });

  it("add at earlier ts then loseAll at later ts strips everything", () => {
    const c = emptyCharacteristics();
    c.abilities.push({ id: mkEntityId(1), grantedBy: null, origin: "intrinsic" });
    applyLayer6Ability(c, [
      { kind: "add", abilityId: mkEntityId(2), grantedBy: mkEntityId(8), origin: "layer6", timestamp: 1 },
      { kind: "loseAll", timestamp: 2 },
    ]);
    expect(c.abilities).toHaveLength(0);
  });

  it("empty effects leaves target unchanged", () => {
    const c = emptyCharacteristics();
    c.abilities.push({ id: mkEntityId(1), grantedBy: null, origin: "intrinsic" });
    applyLayer6Ability(c, []);
    expect(c.abilities).toHaveLength(1);
  });
});

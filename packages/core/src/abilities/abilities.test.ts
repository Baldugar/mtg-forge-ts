// SPDX-License-Identifier: GPL-3.0-or-later
// Type-only smoke: hand-built subtypes satisfy each interface.
import { describe, expect, it } from "vitest";
import { mkEntityId, mkPlayerSeat } from "../ids.js";
import { ZoneType } from "../zone.js";
import type {
  ActivatedAbility,
  DelayedTrigger,
  ReplacementAbility,
  StaticAbility,
  TriggeredAbility,
} from "./index.js";

describe("Ability interfaces (SP2 §B)", () => {
  it("TriggeredAbility is constructable with minimum fields", () => {
    const t: TriggeredAbility = {
      id: mkEntityId(1),
      kind: "triggered",
      sourceCardId: mkEntityId(10),
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      matches: () => true,
      isDelayed: false,
    };
    expect(t.kind).toBe("triggered");
    expect(t.isDelayed).toBe(false);
  });

  it("ReplacementAbility must mark isSelfReplacement", () => {
    const r: ReplacementAbility = {
      id: mkEntityId(2),
      kind: "replacement",
      sourceCardId: mkEntityId(11),
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      matches: () => true,
      apply: () => null,
      isSelfReplacement: true,
      layer: "other",
    };
    expect(r.isSelfReplacement).toBe(true);
  });

  it("StaticAbility categorizes and describes", () => {
    const s: StaticAbility = {
      id: mkEntityId(3),
      kind: "static",
      sourceCardId: mkEntityId(12),
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: null,
      category: "continuous",
      describe: () => ({ shape: "test" }),
    };
    expect(s.category).toBe("continuous");
  });

  it("ActivatedAbility carries DSL strings and mana flag", () => {
    const a: ActivatedAbility = {
      id: mkEntityId(4),
      kind: "mana",
      sourceCardId: mkEntityId(13),
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(1),
      costDsl: "T",
      effectDsl: "AddMana G",
      isManaAbility: true,
    };
    expect(a.isManaAbility).toBe(true);
    expect(a.kind).toBe("mana");
  });

  it("DelayedTrigger marks isDelayed:true, captures creation context", () => {
    const d: DelayedTrigger = {
      id: mkEntityId(5),
      kind: "triggered",
      sourceCardId: mkEntityId(14),
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Exile]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      isDelayed: true,
      createdAtTurn: 3,
      creationContext: { targetId: mkEntityId(100) },
      oneShot: true,
      matches: () => true,
    };
    expect(d.isDelayed).toBe(true);
    expect(d.createdAtTurn).toBe(3);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// ReplacementRegistry tests — CR 614 scaffold (SP2 Task 16).
import type { MutationIntent, ReplacementAbility } from "@mtg-forge-ts/core";
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { ReplacementRegistry } from "./replacement-registry.js";

const mkReplacement = (opts: {
  id: number;
  sourceCardId: number;
  matchesFn?: (i: MutationIntent) => boolean;
  isSelfReplacement?: boolean;
}): ReplacementAbility => ({
  id: mkEntityId(opts.id),
  kind: "replacement",
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches: opts.matchesFn ?? (() => true),
  apply: (intent) => intent,
  isSelfReplacement: opts.isSelfReplacement ?? false,
  layer: "other",
});

describe("ReplacementRegistry (CR 614 scaffold)", () => {
  it("register + gatherApplicable returns matching replacements", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    const result = reg.gatherApplicable({ kind: "damage" } as MutationIntent, new Set());
    expect(result).toHaveLength(1);
  });

  it("gatherApplicable respects matches()", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10, matchesFn: (i) => i.kind === "damage" }));
    expect(reg.gatherApplicable({ kind: "damage" } as MutationIntent, new Set())).toHaveLength(1);
    expect(reg.gatherApplicable({ kind: "lifeChange" } as MutationIntent, new Set())).toHaveLength(0);
  });

  it("gatherApplicable respects excluded set", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    reg.register(mkReplacement({ id: 2, sourceCardId: 11 }));
    const excluded = new Set([mkEntityId(1)]);
    const result = reg.gatherApplicable({ kind: "damage" } as MutationIntent, excluded);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(mkEntityId(2));
  });

  it("unregister by id removes it", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    reg.unregister(mkEntityId(1));
    expect(reg.size()).toBe(0);
    expect(reg.gatherApplicable({ kind: "damage" } as MutationIntent, new Set())).toHaveLength(0);
  });

  it("unregister is a no-op when id not registered", () => {
    const reg = new ReplacementRegistry();
    reg.unregister(mkEntityId(999));
    expect(reg.size()).toBe(0);
  });

  it("unregisterAllForCard removes every replacement from that source", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    reg.register(mkReplacement({ id: 2, sourceCardId: 10 }));
    reg.register(mkReplacement({ id: 3, sourceCardId: 11 }));
    reg.unregisterAllForCard(mkEntityId(10));
    expect(reg.size()).toBe(1);
    expect(reg.byCard(mkEntityId(10))).toHaveLength(0);
    expect(reg.byCard(mkEntityId(11))).toHaveLength(1);
  });

  it("byCard returns replacements sourced by a specific card", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    reg.register(mkReplacement({ id: 2, sourceCardId: 10 }));
    reg.register(mkReplacement({ id: 3, sourceCardId: 11 }));
    expect(reg.byCard(mkEntityId(10))).toHaveLength(2);
    expect(reg.byCard(mkEntityId(11))).toHaveLength(1);
    expect(reg.byCard(mkEntityId(99))).toHaveLength(0);
  });

  it("all() returns every registered replacement", () => {
    const reg = new ReplacementRegistry();
    reg.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    reg.register(mkReplacement({ id: 2, sourceCardId: 11 }));
    expect(reg.all()).toHaveLength(2);
  });
});

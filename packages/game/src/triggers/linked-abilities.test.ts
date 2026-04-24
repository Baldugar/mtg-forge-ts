// SPDX-License-Identifier: GPL-3.0-or-later
// LinkedAbilityTable tests — CR 607 (SP2 Task 24). Keyed by ability-
// instance id so concurrent linked pairs (e.g., two flicker activations
// on the same turn) don't collide.
import { mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { LinkedAbilityTable } from "./linked-abilities.js";

describe("LinkedAbilityTable (CR 607)", () => {
  it("set + get roundtrip", () => {
    const tbl = new LinkedAbilityTable();
    const instance = mkEntityId(1);
    const linked = [mkEntityId(10), mkEntityId(11)];
    tbl.set(instance, linked);
    expect(tbl.get(instance)).toEqual(linked);
  });

  it("get on unknown instance returns empty", () => {
    const tbl = new LinkedAbilityTable();
    expect(tbl.get(mkEntityId(999))).toEqual([]);
  });

  it("clear removes the entry", () => {
    const tbl = new LinkedAbilityTable();
    tbl.set(mkEntityId(1), [mkEntityId(10)]);
    expect(tbl.has(mkEntityId(1))).toBe(true);
    tbl.clear(mkEntityId(1));
    expect(tbl.has(mkEntityId(1))).toBe(false);
    expect(tbl.size()).toBe(0);
  });

  it("set with [] is distinguishable from never-set via has()", () => {
    const tbl = new LinkedAbilityTable();
    tbl.set(mkEntityId(1), []);
    expect(tbl.has(mkEntityId(1))).toBe(true);
    expect(tbl.get(mkEntityId(1))).toEqual([]);
    expect(tbl.has(mkEntityId(2))).toBe(false);
    expect(tbl.get(mkEntityId(2))).toEqual([]);
  });

  it("multiple instances stored independently", () => {
    const tbl = new LinkedAbilityTable();
    tbl.set(mkEntityId(1), [mkEntityId(10), mkEntityId(11)]);
    tbl.set(mkEntityId(2), [mkEntityId(20)]);
    expect(tbl.get(mkEntityId(1))).toEqual([mkEntityId(10), mkEntityId(11)]);
    expect(tbl.get(mkEntityId(2))).toEqual([mkEntityId(20)]);
    expect(tbl.size()).toBe(2);
  });

  it("set copies the input array so caller mutation doesn't leak", () => {
    const tbl = new LinkedAbilityTable();
    const mutable = [mkEntityId(10), mkEntityId(11)];
    tbl.set(mkEntityId(1), mutable);
    mutable.push(mkEntityId(999));
    expect(tbl.get(mkEntityId(1))).toEqual([mkEntityId(10), mkEntityId(11)]);
  });

  it("Game.linkedAbilities is wired on the Game instance", async () => {
    // Separate import to keep this suite otherwise Game-free.
    const { Game } = await import("../game.js");
    const { SeededRng } = await import("@mtg-forge-ts/core");
    const alice = { id: "P0", name: "P0", controllerKind: "human" as const };
    const bob = { id: "P1", name: "P1", controllerKind: "human" as const };
    const rules = {
      formatId: "standard",
      startingLife: 20,
      startingHandSize: 7,
      mulliganRule: "london" as const,
      firstPlayerSkipsDraw: true,
      ruleOverrides: [],
      playerCount: { min: 2, max: 2 },
      poisonCountersToLose: 10,
      playForAnte: false,
      manaBurn: false,
      gamesPerMatch: 1,
      appliedVariants: [],
    };
    const meta = {
      engineVersion: "0.0.0",
      forgeSha: "test",
      cardDataSyncedAt: "2026-04-23T00:00:00Z",
      crVersion: "2024-11-08",
      seed: "deadbeef",
    };
    const g = new Game({
      lobbyPlayers: [alice, bob],
      rules,
      meta,
      rng: new SeededRng(0xdeadbeefn),
    });
    expect(g.linkedAbilities).toBeInstanceOf(LinkedAbilityTable);
    expect(g.linkedAbilities.size()).toBe(0);
  });
});

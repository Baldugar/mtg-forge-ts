// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { CounterType, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Player } from "./player.js";
import { Library } from "./zone/zones/library.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };

describe("Player", () => {
  it("constructs with seat + LobbyPlayer + teamId; defaults are correct", () => {
    const seat = mkPlayerSeat(0);
    const p = new Player(seat, alice, 0);
    expect(p.seat).toBe(seat);
    expect(p.lobbyPlayer).toBe(alice);
    expect(p.teamId).toBe(0);
    expect(p.life).toBe(20);
    expect(p.counters.size).toBe(0);
    expect(p.manaPool).toBeNull();
    expect(p.zones.size).toBe(0);
  });

  it("counters Map works with CounterType keys", () => {
    const p = new Player(mkPlayerSeat(0), alice, 0);
    p.counters.set(CounterType.Poison, 3);
    p.counters.set(CounterType.Energy, 5);
    expect(p.counters.get(CounterType.Poison)).toBe(3);
    expect(p.counters.get(CounterType.Energy)).toBe(5);
  });

  it("teamId is mutable; life is mutable", () => {
    const p = new Player(mkPlayerSeat(0), alice, 0);
    p.teamId = 1;
    p.life = 17;
    expect(p.teamId).toBe(1);
    expect(p.life).toBe(17);
  });

  it("zones map accepts Zone instances keyed by ZoneType", () => {
    const p = new Player(mkPlayerSeat(0), alice, 0);
    const lib = new Library(ZoneType.Library, p.seat);
    p.zones.set(ZoneType.Library, lib);
    expect(p.zones.get(ZoneType.Library)).toBe(lib);
  });

  it("toJSON emits lobbyPlayerId (not the LobbyPlayer object) + summary fields", () => {
    const p = new Player(mkPlayerSeat(2), alice, 1);
    p.life = 18;
    p.counters.set(CounterType.Poison, 2);

    const json = p.toJSON();
    expect(json.seat).toBe(mkPlayerSeat(2));
    expect(json.lobbyPlayerId).toBe("p-alice");
    expect(json).not.toHaveProperty("lobbyPlayer");
    expect(json.teamId).toBe(1);
    expect(json.life).toBe(18);
    expect(json.counters).toEqual({ [CounterType.Poison]: 2 });

    const rt = JSON.parse(JSON.stringify(json)) as typeof json;
    expect(rt).toEqual(json);
  });
});

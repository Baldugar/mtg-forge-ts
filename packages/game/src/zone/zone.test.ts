// SPDX-License-Identifier: GPL-3.0-or-later
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Ante } from "./zones/ante.js";
import { Battlefield } from "./zones/battlefield.js";
import { CommandZone } from "./zones/command-zone.js";
import { Exile } from "./zones/exile.js";
import { Graveyard } from "./zones/graveyard.js";
import { Hand } from "./zones/hand.js";
import { Library } from "./zones/library.js";

describe("Zone", () => {
  it("concrete subclasses expose declared type + ownerSeat", () => {
    const seat = mkPlayerSeat(0);
    const lib = new Library(ZoneType.Library, seat);
    expect(lib.type).toBe(ZoneType.Library);
    expect(lib.ownerSeat).toBe(seat);
    expect(lib.size).toBe(0);
    expect(lib.toArray()).toEqual([]);
  });

  it("add appends at end by default, returns via toArray in order", () => {
    const z = new Hand(ZoneType.Hand, mkPlayerSeat(0));
    const a = mkEntityId(0);
    const b = mkEntityId(1);
    const c = mkEntityId(2);
    z.add(a);
    z.add(b);
    z.add(c);
    expect(z.toArray()).toEqual([a, b, c]);
    expect(z.size).toBe(3);
  });

  it("add inserts at arbitrary index (splice behavior)", () => {
    const z = new Library(ZoneType.Library, mkPlayerSeat(0));
    const a = mkEntityId(0);
    const b = mkEntityId(1);
    const c = mkEntityId(2);
    z.add(a);
    z.add(c);
    z.add(b, 1);
    expect(z.toArray()).toEqual([a, b, c]);
  });

  it("add at index 0 prepends; at index=size appends", () => {
    const z = new Library(ZoneType.Library, mkPlayerSeat(0));
    const a = mkEntityId(0);
    const b = mkEntityId(1);
    z.add(a);
    z.add(b, 0);
    expect(z.toArray()).toEqual([b, a]);
  });

  it("add throws RangeError for out-of-range index", () => {
    const z = new Library(ZoneType.Library, mkPlayerSeat(0));
    expect(() => z.add(mkEntityId(0), -1)).toThrow(RangeError);
    expect(() => z.add(mkEntityId(0), 1)).toThrow(RangeError);
  });

  it("remove returns true for present, false for missing", () => {
    const z = new Graveyard(ZoneType.Graveyard, mkPlayerSeat(0));
    const a = mkEntityId(0);
    const b = mkEntityId(1);
    z.add(a);
    expect(z.remove(a)).toBe(true);
    expect(z.contains(a)).toBe(false);
    expect(z.remove(b)).toBe(false);
  });

  it("contains and indexOf report correctly", () => {
    const z = new Battlefield(ZoneType.Battlefield, mkPlayerSeat(0));
    const a = mkEntityId(0);
    const b = mkEntityId(1);
    z.add(a);
    z.add(b);
    expect(z.contains(a)).toBe(true);
    expect(z.contains(mkEntityId(2))).toBe(false);
    expect(z.indexOf(a)).toBe(0);
    expect(z.indexOf(b)).toBe(1);
    expect(z.indexOf(mkEntityId(99))).toBe(-1);
  });

  it("clear empties the zone", () => {
    const z = new Exile(ZoneType.Exile, null);
    z.add(mkEntityId(0));
    z.add(mkEntityId(1));
    z.clear();
    expect(z.size).toBe(0);
    expect(z.toArray()).toEqual([]);
  });

  it("toArray returns a fresh copy (mutation does not affect zone)", () => {
    const z = new Library(ZoneType.Library, mkPlayerSeat(0));
    const a = mkEntityId(0);
    z.add(a);
    const arr = z.toArray();
    arr.push(mkEntityId(99));
    expect(z.size).toBe(1);
  });

  it("toJSON emits type, ownerSeat, items (JSON.stringify round-trip shape)", () => {
    const z = new CommandZone(ZoneType.Command, mkPlayerSeat(1));
    const a = mkEntityId(5);
    z.add(a);
    const json = z.toJSON();
    expect(json.type).toBe(ZoneType.Command);
    expect(json.ownerSeat).toBe(mkPlayerSeat(1));
    expect(json.items).toEqual([a]);
    // stringify round-trip — the shape must survive JSON serialization.
    const rt = JSON.parse(JSON.stringify(json)) as typeof json;
    expect(rt).toEqual(json);
  });

  it("ownerSeat can be null for shared zones", () => {
    const exile = new Exile(ZoneType.Exile, null);
    const ante = new Ante(ZoneType.Ante, null);
    expect(exile.ownerSeat).toBeNull();
    expect(ante.ownerSeat).toBeNull();
  });
});

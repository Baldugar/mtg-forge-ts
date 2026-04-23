// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color } from "../color.js";
import { mkEntityId } from "../ids.js";
import { ManaShard } from "./shard.js";

describe("ManaShard factories", () => {
  it("colored() produces a colored non-snow shard with given sourceId and default restriction", () => {
    const s = ManaShard.colored(Color.Red, { sourceId: mkEntityId(42) });
    expect(s.color).toBe(Color.Red);
    expect(s.isSnow).toBe(false);
    expect(s.restriction).toBe("none");
    expect(s.sourceId).toBe(42);
  });

  it("colored() propagates restriction option", () => {
    const s = ManaShard.colored(Color.Green, { restriction: "creatureSpells" });
    expect(s.color).toBe(Color.Green);
    expect(s.restriction).toBe("creatureSpells");
    expect(s.sourceId).toBeNull();
    expect(s.isSnow).toBe(false);
  });

  it("colorless() produces a null-color non-snow shard", () => {
    const s = ManaShard.colorless();
    expect(s.color).toBeNull();
    expect(s.sourceId).toBeNull();
    expect(s.isSnow).toBe(false);
    expect(s.restriction).toBe("none");
  });

  it("snow(Color.Blue) produces a snow shard with color Blue", () => {
    const s = ManaShard.snow(Color.Blue);
    expect(s.isSnow).toBe(true);
    expect(s.color).toBe(Color.Blue);
    expect(s.sourceId).toBeNull();
    expect(s.restriction).toBe("none");
  });

  it("snow(null) produces a colorless snow shard", () => {
    const s = ManaShard.snow(null);
    expect(s.isSnow).toBe(true);
    expect(s.color).toBeNull();
  });
});

describe("ManaShard serialization", () => {
  it("round-trips a colored shard with sourceId through JSON", () => {
    const original = ManaShard.colored(Color.Red, {
      sourceId: mkEntityId(42),
      restriction: "onlyThisTurn",
    });
    const roundTripped = ManaShard.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));
    expect(roundTripped.color).toBe(original.color);
    expect(roundTripped.sourceId).toBe(original.sourceId);
    expect(roundTripped.isSnow).toBe(original.isSnow);
    expect(roundTripped.restriction).toBe(original.restriction);
  });

  it("round-trips a snow shard", () => {
    const original = ManaShard.snow(Color.Blue, { sourceId: mkEntityId(7) });
    const roundTripped = ManaShard.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));
    expect(roundTripped.color).toBe(Color.Blue);
    expect(roundTripped.isSnow).toBe(true);
    expect(roundTripped.sourceId).toBe(7);
    expect(roundTripped.restriction).toBe("none");
  });

  it("round-trips a colorless shard with no sourceId", () => {
    const original = ManaShard.colorless();
    const roundTripped = ManaShard.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));
    expect(roundTripped.color).toBeNull();
    expect(roundTripped.sourceId).toBeNull();
    expect(roundTripped.isSnow).toBe(false);
    expect(roundTripped.restriction).toBe("none");
  });
});

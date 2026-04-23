// SPDX-License-Identifier: GPL-3.0-or-later
import type { PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
  paperCardKey,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";

const sampleCard: PaperCard = {
  name: "Llanowar Elves",
  edition: "LEA",
  collectorNumber: "236",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

describe("Card", () => {
  it("constructs with identity + seats + zone; defaults are live-field sane", () => {
    const id = mkEntityId(42);
    const seat = mkPlayerSeat(0);
    const c = new Card(id, sampleCard, seat, seat, ZoneType.Library);
    expect(c.id).toBe(id);
    expect(c.paperCard).toBe(sampleCard);
    expect(c.ownerSeat).toBe(seat);
    expect(c.controllerSeat).toBe(seat);
    expect(c.zone).toBe(ZoneType.Library);
    expect(c.tapped).toBe(false);
    expect(c.phased).toBe(false);
    expect(c.damage).toBe(0);
    expect(c.counters.size).toBe(0);
    expect(c.attachedTo).toBeNull();
    expect(c.attachments).toEqual([]);
    expect(c.copiedFrom).toBeNull();
    expect(c.faceDown).toBeNull();
  });

  it("counters Map is usable with CounterType keys", () => {
    const c = new Card(mkEntityId(0), sampleCard, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    c.counters.set(CounterType.PlusOnePlusOne, 2);
    c.counters.set(CounterType.Loyalty, 3);
    expect(c.counters.get(CounterType.PlusOnePlusOne)).toBe(2);
    expect(c.counters.get(CounterType.Loyalty)).toBe(3);
  });

  it("damage and tapped/phased are mutable", () => {
    const c = new Card(mkEntityId(0), sampleCard, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    c.tapped = true;
    c.phased = true;
    c.damage = 5;
    expect(c.tapped).toBe(true);
    expect(c.phased).toBe(true);
    expect(c.damage).toBe(5);
  });

  it("toJSON emits paperCardKey (not the full PaperCard) and all live fields", () => {
    const id = mkEntityId(7);
    const owner = mkPlayerSeat(0);
    const controller = mkPlayerSeat(1);
    const c = new Card(id, sampleCard, owner, controller, ZoneType.Graveyard);
    c.tapped = true;
    c.damage = 3;
    c.counters.set(CounterType.PlusOnePlusOne, 4);
    c.attachedTo = mkEntityId(99);
    c.attachments = [mkEntityId(100), mkEntityId(101)];

    const json = c.toJSON();
    expect(json.id).toBe(id);
    expect(json.paperCardKey).toBe(paperCardKey(sampleCard));
    expect(json).not.toHaveProperty("paperCard");
    expect(json.ownerSeat).toBe(owner);
    expect(json.controllerSeat).toBe(controller);
    expect(json.zone).toBe(ZoneType.Graveyard);
    expect(json.tapped).toBe(true);
    expect(json.damage).toBe(3);
    expect(json.counters).toEqual({ [CounterType.PlusOnePlusOne]: 4 });
    expect(json.attachedTo).toBe(mkEntityId(99));
    expect(json.attachments).toEqual([mkEntityId(100), mkEntityId(101)]);

    // Mutating the returned attachments array must not affect the Card.
    json.attachments.push(mkEntityId(999));
    expect(c.attachments).toHaveLength(2);

    // JSON.stringify round-trips the shape.
    const rt = JSON.parse(JSON.stringify(json)) as typeof json;
    expect(rt.paperCardKey).toBe(json.paperCardKey);
  });
});

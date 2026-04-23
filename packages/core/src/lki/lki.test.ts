// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { mkEntityId, mkPlayerSeat } from "../ids.js";
import { CardType, emptyCharacteristics } from "../index.js";
import { ZoneType } from "../zone.js";
import { type LkiInput, captureLki } from "./lki.js";

describe("captureLki (SP2 §B)", () => {
  const mkInput = (): LkiInput => {
    const chars = emptyCharacteristics();
    chars.name = "Grizzly Bears";
    chars.types.add(CardType.Creature);
    chars.power = 2;
    chars.toughness = 2;
    return {
      cardId: mkEntityId(42),
      timestamp: 7,
      chars,
      zone: ZoneType.Battlefield,
      controllerSeat: mkPlayerSeat(0),
      tapped: false,
      damage: 0,
    };
  };

  it("captures the supplied primitive fields", () => {
    const lki = captureLki(mkInput());
    expect(lki.cardId).toBe(mkEntityId(42));
    expect(lki.timestamp).toBe(7);
    expect(lki.zone).toBe(ZoneType.Battlefield);
    expect(lki.controllerSeat).toBe(mkPlayerSeat(0));
    expect(lki.tapped).toBe(false);
    expect(lki.damage).toBe(0);
  });

  it("freezes characteristics (Object.isFrozen returns true)", () => {
    const lki = captureLki(mkInput());
    expect(Object.isFrozen(lki.chars)).toBe(true);
  });

  it("LKI is independent of the source Characteristics (mutation doesn't leak)", () => {
    const input = mkInput();
    const lki = captureLki(input);
    // Mutate the original after capture.
    input.chars.name = "Changed";
    input.chars.types.add(CardType.Artifact);
    input.chars.power = 99;
    expect(lki.chars.name).toBe("Grizzly Bears");
    expect(lki.chars.types.has(CardType.Artifact)).toBe(false);
    expect(lki.chars.power).toBe(2);
  });

  it("LKI's Sets are their own copies (not shared references)", () => {
    const input = mkInput();
    const lki = captureLki(input);
    input.chars.types.delete(CardType.Creature);
    expect(lki.chars.types.has(CardType.Creature)).toBe(true);
  });

  it("captures dies-scenario: creature leaves with damage marked", () => {
    const base = mkInput();
    base.chars.toughness = 2;
    const input: LkiInput = {
      ...base,
      damage: 2,
      zone: ZoneType.Battlefield,
    };
    const lki = captureLki(input);
    // dies-trigger resolves after zone-change — LKI preserves pre-move state.
    expect(lki.damage).toBe(2);
    expect(lki.zone).toBe(ZoneType.Battlefield);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { ZoneType, isBattlefieldZone, isHiddenZone, isPerPlayerZone } from "./zone.js";

describe("ZoneType", () => {
  it("defines all 19 canonical zone types", () => {
    const expected = [
      "library",
      "hand",
      "battlefield",
      "graveyard",
      "exile",
      "stack",
      "command",
      "ante",
      "sideboard",
      "planarDeck",
      "schemeDeck",
      "conspiracyDeck",
      "attractionDeck",
      "contraptionDeck",
      "stickerDeck",
      "banished",
      "phased",
      "none",
      "outsideGame",
    ];
    expect(Object.values(ZoneType).sort()).toEqual(expected.sort());
  });

  it("isPerPlayerZone: library, hand, graveyard, battlefield, sideboard, deck-y zones", () => {
    expect(isPerPlayerZone(ZoneType.Library)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Hand)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Graveyard)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Battlefield)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Sideboard)).toBe(true);
    expect(isPerPlayerZone(ZoneType.PlanarDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.SchemeDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.ConspiracyDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.AttractionDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.ContraptionDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.StickerDeck)).toBe(true);
  });

  it("isPerPlayerZone: Stack, Exile, Command, Ante are NOT per-player", () => {
    expect(isPerPlayerZone(ZoneType.Stack)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Exile)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Command)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Ante)).toBe(false);
  });

  it("isHiddenZone: library, hand, sideboard", () => {
    expect(isHiddenZone(ZoneType.Library)).toBe(true);
    expect(isHiddenZone(ZoneType.Hand)).toBe(true);
    expect(isHiddenZone(ZoneType.Sideboard)).toBe(true);
    expect(isHiddenZone(ZoneType.Battlefield)).toBe(false);
    expect(isHiddenZone(ZoneType.Graveyard)).toBe(false);
  });

  it("isBattlefieldZone is true only for Battlefield", () => {
    expect(isBattlefieldZone(ZoneType.Battlefield)).toBe(true);
    expect(isBattlefieldZone(ZoneType.Library)).toBe(false);
    expect(isBattlefieldZone(ZoneType.Stack)).toBe(false);
  });
});

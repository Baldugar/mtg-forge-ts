// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  HIDDEN_ZONES,
  ZoneType,
  isBattlefieldZone,
  isDeckZone,
  isHiddenZone,
  isPartOfCommandZone,
  isPerPlayerZone,
} from "./zone.js";

describe("ZoneType", () => {
  it("defines Forge's canonical 19 zones in PascalCase", () => {
    const expected = [
      "Hand",
      "Library",
      "Graveyard",
      "Battlefield",
      "Exile",
      "Flashback",
      "Command",
      "Stack",
      "Sideboard",
      "Ante",
      "Merged",
      "SchemeDeck",
      "PlanarDeck",
      "AttractionDeck",
      "Junkyard",
      "ContraptionDeck",
      "Subgame",
      "ExtraHand",
      "None",
    ];
    expect(Object.values(ZoneType).sort()).toEqual([...expected].sort());
    expect(Object.values(ZoneType)).toHaveLength(19);
  });

  it("exposes the Forge-added entries previously missing from our enum", () => {
    expect(ZoneType.Flashback).toBe("Flashback");
    expect(ZoneType.Merged).toBe("Merged");
    expect(ZoneType.Junkyard).toBe("Junkyard");
    expect(ZoneType.Subgame).toBe("Subgame");
    expect(ZoneType.ExtraHand).toBe("ExtraHand");
  });

  it("HIDDEN_ZONES matches Forge's holdsHiddenInfo ctor flag exactly", () => {
    // Derived from forge.game.zone.ZoneType.java: every zone declared with
    // holdsHidden=true becomes a member here.
    const forgeHidden = new Set<ZoneType>([
      ZoneType.Hand,
      ZoneType.Library,
      ZoneType.Sideboard,
      ZoneType.SchemeDeck,
      ZoneType.PlanarDeck,
      ZoneType.AttractionDeck,
      ZoneType.ContraptionDeck,
      ZoneType.Subgame,
      ZoneType.ExtraHand,
      ZoneType.None,
    ]);
    // Mutual subset check.
    for (const z of forgeHidden) expect(HIDDEN_ZONES.has(z)).toBe(true);
    for (const z of HIDDEN_ZONES) expect(forgeHidden.has(z)).toBe(true);
    // Explicit not-hidden sampling.
    expect(HIDDEN_ZONES.has(ZoneType.Battlefield)).toBe(false);
    expect(HIDDEN_ZONES.has(ZoneType.Graveyard)).toBe(false);
    expect(HIDDEN_ZONES.has(ZoneType.Exile)).toBe(false);
    expect(HIDDEN_ZONES.has(ZoneType.Stack)).toBe(false);
  });

  it("isHiddenZone is backed by HIDDEN_ZONES", () => {
    expect(isHiddenZone(ZoneType.Library)).toBe(true);
    expect(isHiddenZone(ZoneType.Hand)).toBe(true);
    expect(isHiddenZone(ZoneType.Sideboard)).toBe(true);
    expect(isHiddenZone(ZoneType.ExtraHand)).toBe(true);
    expect(isHiddenZone(ZoneType.None)).toBe(true);
    expect(isHiddenZone(ZoneType.Battlefield)).toBe(false);
    expect(isHiddenZone(ZoneType.Graveyard)).toBe(false);
  });

  it("isDeckZone matches Forge's DECK_ZONES static EnumSet", () => {
    expect(isDeckZone(ZoneType.Library)).toBe(true);
    expect(isDeckZone(ZoneType.SchemeDeck)).toBe(true);
    expect(isDeckZone(ZoneType.PlanarDeck)).toBe(true);
    expect(isDeckZone(ZoneType.AttractionDeck)).toBe(true);
    expect(isDeckZone(ZoneType.ContraptionDeck)).toBe(true);
    // Not deck zones:
    expect(isDeckZone(ZoneType.Hand)).toBe(false);
    expect(isDeckZone(ZoneType.Graveyard)).toBe(false);
    expect(isDeckZone(ZoneType.Battlefield)).toBe(false);
    expect(isDeckZone(ZoneType.Sideboard)).toBe(false);
    expect(isDeckZone(ZoneType.Junkyard)).toBe(false);
  });

  it("isPartOfCommandZone matches Forge's PART_OF_COMMAND_ZONE static EnumSet", () => {
    expect(isPartOfCommandZone(ZoneType.Command)).toBe(true);
    expect(isPartOfCommandZone(ZoneType.SchemeDeck)).toBe(true);
    expect(isPartOfCommandZone(ZoneType.PlanarDeck)).toBe(true);
    expect(isPartOfCommandZone(ZoneType.AttractionDeck)).toBe(true);
    expect(isPartOfCommandZone(ZoneType.ContraptionDeck)).toBe(true);
    expect(isPartOfCommandZone(ZoneType.Junkyard)).toBe(true);
    // Not part of command zone:
    expect(isPartOfCommandZone(ZoneType.Library)).toBe(false);
    expect(isPartOfCommandZone(ZoneType.Battlefield)).toBe(false);
    expect(isPartOfCommandZone(ZoneType.Exile)).toBe(false);
    expect(isPartOfCommandZone(ZoneType.Stack)).toBe(false);
  });

  it("isPerPlayerZone covers library, hand, graveyard, battlefield, sideboard, deck-y zones, plus ExtraHand/Junkyard", () => {
    expect(isPerPlayerZone(ZoneType.Library)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Hand)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Graveyard)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Battlefield)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Sideboard)).toBe(true);
    expect(isPerPlayerZone(ZoneType.PlanarDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.SchemeDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.AttractionDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.ContraptionDeck)).toBe(true);
    expect(isPerPlayerZone(ZoneType.Junkyard)).toBe(true);
    expect(isPerPlayerZone(ZoneType.ExtraHand)).toBe(true);
  });

  it("isPerPlayerZone: Stack, Exile, Command, Ante, Flashback, Merged, Subgame, None are NOT per-player", () => {
    expect(isPerPlayerZone(ZoneType.Stack)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Exile)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Command)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Ante)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Flashback)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Merged)).toBe(false);
    expect(isPerPlayerZone(ZoneType.Subgame)).toBe(false);
    expect(isPerPlayerZone(ZoneType.None)).toBe(false);
  });

  it("isBattlefieldZone is true only for Battlefield", () => {
    expect(isBattlefieldZone(ZoneType.Battlefield)).toBe(true);
    expect(isBattlefieldZone(ZoneType.Library)).toBe(false);
    expect(isBattlefieldZone(ZoneType.Stack)).toBe(false);
    expect(isBattlefieldZone(ZoneType.Merged)).toBe(false);
  });

  it("does not define the zones that were drift-only (not in Forge)", () => {
    // Compile-time + runtime guard: these strings must not appear as enum values.
    const values = Object.values(ZoneType) as string[];
    expect(values).not.toContain("ConspiracyDeck");
    expect(values).not.toContain("StickerDeck");
    expect(values).not.toContain("Banished");
    expect(values).not.toContain("Phased");
    expect(values).not.toContain("OutsideGame");
    // Old lowercase aliases also gone.
    expect(values).not.toContain("conspiracyDeck");
    expect(values).not.toContain("stickerDeck");
    expect(values).not.toContain("outsideGame");
  });
});

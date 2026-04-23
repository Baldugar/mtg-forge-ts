// SPDX-License-Identifier: GPL-3.0-or-later
export enum ZoneType {
  Library = "library",
  Hand = "hand",
  Battlefield = "battlefield",
  Graveyard = "graveyard",
  Exile = "exile",
  Stack = "stack",
  Command = "command",
  Ante = "ante",
  Sideboard = "sideboard",
  PlanarDeck = "planarDeck",
  SchemeDeck = "schemeDeck",
  ConspiracyDeck = "conspiracyDeck",
  AttractionDeck = "attractionDeck",
  ContraptionDeck = "contraptionDeck",
  StickerDeck = "stickerDeck",
  Banished = "banished",
  Phased = "phased",
  None = "none",
  OutsideGame = "outsideGame",
}

const PER_PLAYER: ReadonlySet<ZoneType> = new Set([
  ZoneType.Library,
  ZoneType.Hand,
  ZoneType.Graveyard,
  ZoneType.Sideboard,
  ZoneType.PlanarDeck,
  ZoneType.SchemeDeck,
  ZoneType.ConspiracyDeck,
  ZoneType.AttractionDeck,
  ZoneType.ContraptionDeck,
  ZoneType.StickerDeck,
  ZoneType.Battlefield, // per-player per engine model (each player owns their own battlefield)
]);

const HIDDEN: ReadonlySet<ZoneType> = new Set([ZoneType.Library, ZoneType.Hand, ZoneType.Sideboard]);

export const isPerPlayerZone = (z: ZoneType): boolean => PER_PLAYER.has(z);
export const isHiddenZone = (z: ZoneType): boolean => HIDDEN.has(z);
export const isBattlefieldZone = (z: ZoneType): boolean => z === ZoneType.Battlefield;

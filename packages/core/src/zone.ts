// SPDX-License-Identifier: GPL-3.0-or-later
// ZoneType mirrors Forge's forge.game.zone.ZoneType (19 entries in declaration
// order). String values use PascalCase matching Forge's name() so serialized
// payloads round-trip with the Java side. HIDDEN_ZONES membership is the TS
// analog of Forge's per-entry holdsHiddenInfo ctor flag.
export enum ZoneType {
  Hand = "Hand",
  Library = "Library",
  Graveyard = "Graveyard",
  Battlefield = "Battlefield",
  Exile = "Exile",
  Flashback = "Flashback",
  Command = "Command",
  Stack = "Stack",
  Sideboard = "Sideboard",
  Ante = "Ante",
  Merged = "Merged",
  SchemeDeck = "SchemeDeck",
  PlanarDeck = "PlanarDeck",
  AttractionDeck = "AttractionDeck",
  Junkyard = "Junkyard",
  ContraptionDeck = "ContraptionDeck",
  Subgame = "Subgame",
  ExtraHand = "ExtraHand",
  None = "None",
}

// Forge: ZoneType(holdsHidden) ctor → isHidden() returns holdsHiddenInfo.
// Membership verified against forge-game/src/main/java/forge/game/zone/ZoneType.java.
export const HIDDEN_ZONES: ReadonlySet<ZoneType> = new Set([
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

// Forge: DECK_ZONES static EnumSet — zones that behave as ordered face-down
// piles (library-like).
const DECK_ZONES: ReadonlySet<ZoneType> = new Set([
  ZoneType.Library,
  ZoneType.SchemeDeck,
  ZoneType.PlanarDeck,
  ZoneType.AttractionDeck,
  ZoneType.ContraptionDeck,
]);

// Forge: PART_OF_COMMAND_ZONE static EnumSet — zones rendered/treated as part
// of the command-zone aggregate.
const PART_OF_COMMAND_ZONE: ReadonlySet<ZoneType> = new Set([
  ZoneType.Command,
  ZoneType.SchemeDeck,
  ZoneType.PlanarDeck,
  ZoneType.AttractionDeck,
  ZoneType.ContraptionDeck,
  ZoneType.Junkyard,
]);

// Engine-side classification (no direct Forge analog): zones that are owned
// per-player rather than shared across the game. Battlefield is per-player in
// our engine model (each player owns their side). Junkyard (contraption
// scrapyard) and ExtraHand (Backup Plan) are per-player by construction.
const PER_PLAYER: ReadonlySet<ZoneType> = new Set([
  ZoneType.Library,
  ZoneType.Hand,
  ZoneType.Graveyard,
  ZoneType.Sideboard,
  ZoneType.PlanarDeck,
  ZoneType.SchemeDeck,
  ZoneType.AttractionDeck,
  ZoneType.ContraptionDeck,
  ZoneType.Battlefield,
  ZoneType.Junkyard,
  ZoneType.ExtraHand,
]);

export const isHiddenZone = (z: ZoneType): boolean => HIDDEN_ZONES.has(z);
export const isDeckZone = (z: ZoneType): boolean => DECK_ZONES.has(z);
export const isPartOfCommandZone = (z: ZoneType): boolean => PART_OF_COMMAND_ZONE.has(z);
export const isPerPlayerZone = (z: ZoneType): boolean => PER_PLAYER.has(z);
export const isBattlefieldZone = (z: ZoneType): boolean => z === ZoneType.Battlefield;

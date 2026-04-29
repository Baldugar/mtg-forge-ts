// SPDX-License-Identifier: GPL-3.0-or-later
// ZoneType mirrors Forge's forge.game.zone.ZoneType (19 entries in declaration
// order) plus our engine-side `OutsideTheGame` slot (Wave 66). String values
// use PascalCase matching Forge's name() so serialized payloads round-trip
// with the Java side. HIDDEN_ZONES membership is the TS analog of Forge's
// per-entry holdsHiddenInfo ctor flag.
//
// Wave 66 adds `OutsideTheGame` — Forge models the "outside the game" surface
// (CR 100.4) implicitly via the Sideboard zone + absence-of-zone fallback.
// We promote it to an explicit zone so the conjure-into-hand path (Double
// team, CR 702.176) and the Companion / Wishes / Learn-lesson tutor paths
// have a concrete source zone. The slot is hidden (per CR 400.4 — players
// don't see what's there) and per-player (each player has their own
// outside-the-game collection). It is NOT a deck zone, NOT part of the
// command zone, and NOT ordered (cards there have no positional meaning).
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
  // Wave 66 — engine-side "outside the game" zone (CR 100.4). Forge has no
  // direct ZoneType.java entry for this, modeling it via Sideboard. Our
  // OutsideTheGame entry holds:
  //   - the conceptual reservoir for `conjureCopyToHand` (Double team).
  //   - companion-card-staging post-declaration, before the 3-mana
  //     once-per-game tutor moves the card to hand.
  //   - Wish targets (cards in the player's collection but not in the
  //     deck/sideboard); SP6's deck-construction surface populates this.
  OutsideTheGame = "OutsideTheGame",
}

// Forge: ZoneType(holdsHidden) ctor → isHidden() returns holdsHiddenInfo.
// Membership verified against forge-game/src/main/java/forge/game/zone/ZoneType.java.
// Wave 66 — `OutsideTheGame` is hidden by construction (players never see the
// other side's outside-the-game collection; CR 100.4 + 400.4).
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
  ZoneType.OutsideTheGame,
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
// Wave 66 — `OutsideTheGame` is per-player (each player has their own
// collection of cards "outside the game" — sideboard staging, wish pool,
// etc.).
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
  ZoneType.OutsideTheGame,
]);

// Forge: ORDERED_ZONES static EnumSet from ZoneType.java — zones whose card
// order is observationally significant (library top/bottom, stack position,
// graveyard sequence for Tarmogoyf-style tallies, hand ordering for UI).
// Consumers scanning for "should I preserve item order?" check membership.
export const ORDERED_ZONES: ReadonlySet<ZoneType> = new Set([
  ZoneType.Library,
  ZoneType.SchemeDeck,
  ZoneType.PlanarDeck,
  ZoneType.AttractionDeck,
  ZoneType.ContraptionDeck,
  ZoneType.Hand,
  ZoneType.Graveyard,
  ZoneType.Stack,
]);

export const isHiddenZone = (z: ZoneType): boolean => HIDDEN_ZONES.has(z);
export const isDeckZone = (z: ZoneType): boolean => DECK_ZONES.has(z);
export const isPartOfCommandZone = (z: ZoneType): boolean => PART_OF_COMMAND_ZONE.has(z);
export const isPerPlayerZone = (z: ZoneType): boolean => PER_PLAYER.has(z);
export const isBattlefieldZone = (z: ZoneType): boolean => z === ZoneType.Battlefield;
export const isOrderedZone = (z: ZoneType): boolean => ORDERED_ZONES.has(z);

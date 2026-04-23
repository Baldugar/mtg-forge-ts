// SPDX-License-Identifier: GPL-3.0-or-later
// Ported from Forge's forge.deck.{Deck,DeckSection}. The Forge source has
// 10 DeckSection entries; the plan file listed 8, so the roster here matches
// Forge (adding Avatar and Dungeon). Forge's flat Commander section becomes a
// CommanderSlot discriminated union so the various commander-family modes
// (single / partners / background / oathbreaker) are representable without
// nullable magic slots.
//
// Section naming follows Forge's enum constants verbatim (plural where Forge
// pluralizes: Planes, Schemes, Dungeons/Attractions/Contraptions are lists of
// cards). The plan used `planar`/`scheme` (singular) which would drift from
// Forge's wire format — rejected in favor of Forge-faithful names.

import type { PaperCard } from "../card/paper-card.js";

export enum DeckSection {
  Main = "Main",
  Sideboard = "Sideboard",
  Commander = "Commander",
  Avatar = "Avatar",
  Planes = "Planes",
  Schemes = "Schemes",
  Conspiracy = "Conspiracy",
  Dungeon = "Dungeon",
  Attractions = "Attractions",
  Contraptions = "Contraptions",
}

/** Mirrors Forge's DeckSection.NONTRADITIONAL_SECTIONS (7-entry array). */
export const NONTRADITIONAL_DECK_SECTIONS: readonly DeckSection[] = [
  DeckSection.Avatar,
  DeckSection.Planes,
  DeckSection.Schemes,
  DeckSection.Conspiracy,
  DeckSection.Dungeon,
  DeckSection.Attractions,
  DeckSection.Contraptions,
];

export interface DeckEntry {
  readonly card: PaperCard;
  readonly count: number;
}

/**
 * Discriminated union for the Commander section. The five kinds cover the
 * 2024-era rules spread: vanilla singleton commander; partner pairs;
 * commander + background; and oathbreaker with its signature spell.
 */
export type CommanderSlot =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly commander: PaperCard }
  | { readonly kind: "partners"; readonly a: PaperCard; readonly b: PaperCard }
  | {
      readonly kind: "background";
      readonly commander: PaperCard;
      readonly background: PaperCard;
    }
  | {
      readonly kind: "oathbreaker";
      readonly planeswalker: PaperCard;
      readonly signatureSpell: PaperCard;
    };

export interface Deck {
  readonly name: string;
  readonly main: readonly DeckEntry[];
  readonly sideboard: readonly DeckEntry[];
  readonly commanderSlot: CommanderSlot;
  readonly avatar?: readonly PaperCard[];
  readonly planes?: readonly PaperCard[];
  readonly schemes?: readonly PaperCard[];
  readonly conspiracy?: readonly PaperCard[];
  readonly dungeons?: readonly PaperCard[];
  readonly attractions?: readonly PaperCard[];
  readonly contraptions?: readonly PaperCard[];
}

export const deckSize = (d: Deck): number => d.main.reduce((n, e) => n + e.count, 0);

export const sideboardSize = (d: Deck): number => d.sideboard.reduce((n, e) => n + e.count, 0);

/**
 * Returns the names of cards in `main` whose count exceeds 1, excluding basic
 * lands. PaperCard.definition may be absent in SP1 (DSL-driven population
 * lands in a later milestone), so basic-land detection is provided by the
 * caller via the `isBasicLand` predicate. Default returns false — i.e. every
 * multi-copy is reported — which is the correct fallback for non-Commander
 * formats that don't special-case basics.
 */
export const hasSingletonViolation = (
  d: Deck,
  isBasicLand: (card: PaperCard) => boolean = () => false,
): readonly string[] => {
  const out: string[] = [];
  for (const e of d.main) {
    if (e.count > 1 && !isBasicLand(e.card)) out.push(e.card.name);
  }
  return out;
};

// Deck is a pure data interface composed of plain objects and arrays with no
// class instances, so JSON.stringify + JSON.parse round-trip as identity.
// These helpers exist for API symmetry with other core types that do need
// bespoke serialization (e.g. ColorSet, TypeLine); consumers may call
// JSON.stringify directly if they prefer.
export const deckToJSON = (d: Deck): Deck => d;
export const deckFromJSON = (s: Deck): Deck => s;

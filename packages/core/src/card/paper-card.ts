// SPDX-License-Identifier: GPL-3.0-or-later
// Ported from Forge's forge.item.PaperCard (the inventory-level card identity
// used for deck building / collection / trading — distinct from the in-game
// Card class). Field reconciliation vs Forge:
//   - Forge fields: name, edition, collectorNumber, artist, artIndex, foil,
//     flags (PaperCardFlags), functionalVariant, rarity.
//   - TS additions: language, scryfallId, definition.
//   - Forge's `edition` is renamed `set` for TS idiomaticity.
// Flags are modeled as a plain struct (not an enum) since each flag is an
// independent boolean; Forge's PaperCardFlags is likewise a struct in Java.

import type { CardDefinition } from "./card-definition.js";
import type { Rarity } from "./types.js";

export interface PaperCardFlags {
  readonly promo: boolean;
  readonly noSell: boolean;
  readonly etched: boolean;
  readonly borderless: boolean;
  readonly artSeries: boolean;
}

export const DEFAULT_PAPER_CARD_FLAGS: PaperCardFlags = {
  promo: false,
  noSell: false,
  etched: false,
  borderless: false,
  artSeries: false,
};

export interface PaperCard {
  readonly name: string;
  readonly set: string;
  readonly collectorNumber: string;
  readonly language: string;
  readonly artist?: string;
  readonly artIndex?: number;
  readonly foil: boolean;
  readonly rarity?: Rarity;
  readonly scryfallId?: string;
  readonly functionalVariant?: string;
  readonly flags: PaperCardFlags;
  readonly definition?: CardDefinition;
}

/**
 * Deterministic identity key for a PaperCard. Two printings that differ only
 * by foil or artIndex must produce distinct keys so inventory / deck lists can
 * treat them as separate SKUs. The `:foil` and `:aN` suffixes are only
 * appended when the relevant flag/index is set to keep the common case short.
 */
export const paperCardKey = (p: PaperCard): string => {
  const base = `${p.set}:${p.collectorNumber}:${p.language}`;
  const foilPart = p.foil ? ":foil" : "";
  const artPart = p.artIndex != null ? `:a${p.artIndex}` : "";
  return `${base}${foilPart}${artPart}`;
};

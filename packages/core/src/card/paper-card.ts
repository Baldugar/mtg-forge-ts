// SPDX-License-Identifier: GPL-3.0-or-later
// Ported from Forge's forge.item.PaperCard (the inventory-level card identity
// used for deck building / collection / trading — distinct from the in-game
// Card class). Field reconciliation vs Forge:
//   - Forge fields: name, edition, collectorNumber, artist, artIndex, foil,
//     flags (PaperCardFlags), functionalVariant, rarity.
//   - TS additions: language, scryfallId, definition, plus optional
//     printing-metadata booleans (promo/etched/borderless/artSeries) that
//     Forge does not carry on PaperCard itself.
// PaperCardFlags mirrors Forge verbatim: `markedColors: ColorSet | null`
// (Cryptic Spires-style user color choice) and `noSellValue: boolean`
// (cards banned from inventory trade/sell). Other per-printing booleans
// sit on PaperCard directly so the Forge-named `flags` surface stays clean.

import type { ColorSet } from "../color.js";
import type { CardDefinition } from "./card-definition.js";
import type { Rarity } from "./types.js";

/**
 * Forge's PaperCard.PaperCardFlags, verbatim. New flag fields land here when
 * Forge adds them; other per-printing metadata belongs on PaperCard directly.
 */
export interface PaperCardFlags {
  /**
   * Player-marked colors for cards with a choose-your-color mechanic
   * (e.g. Cryptic Spires, Prismatic Vista variants). null = unmarked.
   */
  readonly markedColors: ColorSet | null;
  /**
   * "No sell value" — inventory tooling refuses to price / trade / sell.
   * Forge sets this on promo-only / art-series printings that shouldn't
   * influence a collection's wealth.
   */
  readonly noSellValue: boolean;
}

export const DEFAULT_PAPER_CARD_FLAGS: PaperCardFlags = {
  markedColors: null,
  noSellValue: false,
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
  // WHY: these printing-metadata flags are TS-invented (Forge carries them
  // on CardEdition / CardRules, not on PaperCard). Kept on PaperCard as
  // optional booleans so the Forge-named `flags` field stays Forge-faithful.
  readonly promo?: boolean;
  readonly etched?: boolean;
  readonly borderless?: boolean;
  readonly artSeries?: boolean;
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

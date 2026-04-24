// SPDX-License-Identifier: GPL-3.0-or-later
// CR 702.16 — protection from X. Subject has the following vs any object
// with property X (mnemonic: "DEBT"):
//   D — can't be dealt damage (damage is prevented)
//   E — can't be enchanted/equipped/fortified by it
//   B — can't be blocked by it (symmetric — checked either way)
//   T — can't be targeted by spells/abilities from that source
//
// SP2 stores protection tags as keyword strings like "protection:red",
// "protection:elf", "protection:artifact" (case-insensitive matching).
// Card.keywords is the source of truth (SP2 placeholder; SP3 replaces
// with Layer 6 ability grants derived from PaperCard definition text).
import type { EntityId } from "@mtg-forge-ts/core";
import { Color } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";

const PROTECTION_PREFIX = "protection:";

/**
 * Extract protection tags from a card's keyword set. Returns the portion
 * after `protection:` — e.g. "red" for "protection:red". The returned
 * array is a fresh copy; order follows insertion order of the Set.
 */
export const readProtectionTags = (game: Game, cardId: EntityId): readonly string[] => {
  const card = game.cards.get(cardId);
  if (!card) return [];
  const kws = card.keywords;
  if (!kws) return [];
  const out: string[] = [];
  for (const k of kws) {
    if (k.startsWith(PROTECTION_PREFIX)) {
      out.push(k.slice(PROTECTION_PREFIX.length));
    }
  }
  return out;
};

/**
 * Map a lowercase protection tag to a Color bit, if the tag names a color.
 * Accepts both enum-style names ("white", "blue", …) and single-letter
 * MTG codes ("w", "u", "b", "r", "g"). Returns 0 (no match) otherwise.
 */
const colorBitFor = (tagLower: string): number => {
  switch (tagLower) {
    case "white":
    case "w":
      return Color.White;
    case "blue":
    case "u":
      return Color.Blue;
    case "black":
    case "b":
      return Color.Black;
    case "red":
    case "r":
      return Color.Red;
    case "green":
    case "g":
      return Color.Green;
    default:
      return 0;
  }
};

/**
 * Protection matchup: does `subject` have a protection tag that `other`'s
 * computed Characteristics match? Match tests a protection tag against
 * `other`'s color, core type, subtype, or supertype (case-insensitive).
 *
 * Note: CR 702.16 is defined against objects with the named quality; the
 * subject gains immunity vs that object. Combat-block rejection uses the
 * SYMMETRIC check (isBlockLegal queries both directions) because a
 * blocker with protection from red can't block a red attacker, AND a red
 * attacker with protection from the blocker's color/type can't be
 * blocked by it.
 */
export const hasProtectionFrom = (game: Game, subject: EntityId, other: EntityId): boolean => {
  const tags = readProtectionTags(game, subject);
  if (tags.length === 0) return false;
  const otherChars = game.layerEngine.computeCharacteristics(other);
  const otherColorBits = otherChars.colors.toJSON();
  for (const rawTag of tags) {
    const tag = rawTag.toLowerCase();
    // Color match (W/U/B/R/G and long names).
    const colorBit = colorBitFor(tag);
    if (colorBit !== 0 && (otherColorBits & colorBit) !== 0) return true;
    // Core type match.
    for (const t of otherChars.types) {
      if (tag === t.toLowerCase()) return true;
    }
    // Subtype match (subtypes preserve printed casing — compare lower).
    for (const st of otherChars.subtypes) {
      if (tag === st.toLowerCase()) return true;
    }
    // Supertype match.
    for (const sp of otherChars.supertypes) {
      if (tag === sp.toLowerCase()) return true;
    }
  }
  return false;
};

/**
 * Damage protection (CR 702.16b): damage that would be dealt to an object
 * or player by a source it has protection from is prevented. The check
 * consults the target's protection vs the source.
 *
 * Returns true when damage must be prevented (amount becomes 0). Only
 * meaningful for damage to creatures/planeswalkers/battles (cards with
 * an EntityId). Player protection is SP3+ (emblem-backed protection
 * granted by cards like True Name Nemesis is outside SP2 scope).
 */
export const damageProtected = (game: Game, sourceId: EntityId, targetCardId: EntityId): boolean => {
  return hasProtectionFrom(game, targetCardId, sourceId);
};

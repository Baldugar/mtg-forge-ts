// SPDX-License-Identifier: GPL-3.0-or-later
// Ported from Forge's forge.card.CardType (CoreType + Supertype inner enums)
// and forge.card.CardRarity. Rosters reconciled verbatim with Forge source:
//   - Supertype: 7 entries (Forge added Elite for un-set hosts)
//   - CoreType: 15 entries; Tribal was renamed to Kindred by WotC in 2024 and
//     Forge tracks the current rules, so we follow suit. Emblem/Hero are NOT
//     CoreType entries in Forge (they're handled elsewhere) so they're omitted.
//   - Rarity: 8 entries using Forge's short-code string values ("L"/"C"/…) so
//     toString()-style serialization matches Forge wire format.

/** Mirrors Forge's forge.card.CardType.Supertype (7 entries). */
export enum Supertype {
  Basic = "Basic",
  Elite = "Elite",
  Host = "Host",
  Legendary = "Legendary",
  Snow = "Snow",
  Ongoing = "Ongoing",
  World = "World",
}

/**
 * Mirrors Forge's forge.card.CardType.CoreType (15 entries). Exported under
 * the TS-idiomatic name `CardType`; the `CoreType` alias below matches Forge
 * for porters grepping from the Java source.
 */
export enum CardType {
  Kindred = "Kindred",
  Artifact = "Artifact",
  Battle = "Battle",
  Conspiracy = "Conspiracy",
  Enchantment = "Enchantment",
  Creature = "Creature",
  Dungeon = "Dungeon",
  Instant = "Instant",
  Land = "Land",
  Phenomenon = "Phenomenon",
  Plane = "Plane",
  Planeswalker = "Planeswalker",
  Scheme = "Scheme",
  Sorcery = "Sorcery",
  Vanguard = "Vanguard",
}

/** Forge-compatible alias to help port-facing code use Forge's name. */
export { CardType as CoreType };

/**
 * Permanent-ness by core type, mirroring the `isPermanent` boolean wired into
 * each CoreType enum constructor in Forge (CardType.java:44-59).
 */
export const CARD_TYPE_IS_PERMANENT: Readonly<Record<CardType, boolean>> = {
  [CardType.Kindred]: false,
  [CardType.Artifact]: true,
  [CardType.Battle]: true,
  [CardType.Conspiracy]: false,
  [CardType.Enchantment]: true,
  [CardType.Creature]: true,
  [CardType.Dungeon]: false,
  [CardType.Instant]: false,
  [CardType.Land]: true,
  [CardType.Phenomenon]: false,
  [CardType.Plane]: false,
  [CardType.Planeswalker]: true,
  [CardType.Scheme]: false,
  [CardType.Sorcery]: false,
  [CardType.Vanguard]: false,
};

export const isPermanentType = (t: CardType): boolean => CARD_TYPE_IS_PERMANENT[t];

/** Mirrors Forge's CoreType.spellTypes (ImmutableSet.of(Instant, Sorcery)). */
export const SPELL_TYPES: ReadonlySet<CardType> = new Set<CardType>([CardType.Instant, CardType.Sorcery]);

/**
 * Mirrors Forge's forge.card.CardRarity (8 entries). String values are the
 * short codes used by Forge's toString() override so JSON round-trips match
 * Forge wire format.
 */
export enum Rarity {
  BasicLand = "L",
  Common = "C",
  Uncommon = "U",
  Rare = "R",
  MythicRare = "M",
  Special = "S",
  Token = "T",
  Unknown = "?",
}

/** Long display name for each rarity, verbatim from Forge's longName field. */
export const RARITY_LONG_NAME: Readonly<Record<Rarity, string>> = {
  [Rarity.BasicLand]: "Basic Land",
  [Rarity.Common]: "Common",
  [Rarity.Uncommon]: "Uncommon",
  [Rarity.Rare]: "Rare",
  [Rarity.MythicRare]: "Mythic Rare",
  [Rarity.Special]: "Special",
  [Rarity.Token]: "Token",
  [Rarity.Unknown]: "Unknown",
};

/** Verbatim port of Forge's CardRarity.FILTER_OPTIONS (CardRarity.java:30-32). */
export const RARITY_FILTER_OPTIONS: readonly Rarity[] = [
  Rarity.Common,
  Rarity.Uncommon,
  Rarity.Rare,
  Rarity.MythicRare,
  Rarity.Special,
];

// Enum-name lookup: reverse-map each Rarity member to its TS identifier (e.g.
// "MythicRare" → Rarity.MythicRare). Forge's smartValueOf matches on name() so
// we need this table.
const RARITY_BY_NAME: ReadonlyMap<string, Rarity> = new Map<string, Rarity>([
  ["BasicLand", Rarity.BasicLand],
  ["Common", Rarity.Common],
  ["Uncommon", Rarity.Uncommon],
  ["Rare", Rarity.Rare],
  ["MythicRare", Rarity.MythicRare],
  ["Special", Rarity.Special],
  ["Token", Rarity.Token],
  ["Unknown", Rarity.Unknown],
]);

const RARITY_BY_LONG: ReadonlyMap<string, Rarity> = new Map<string, Rarity>(
  Object.entries(RARITY_LONG_NAME).map(([r, long]) => [long.toLowerCase(), r as Rarity]),
);

const RARITY_BY_SHORT: ReadonlyMap<string, Rarity> = new Map<string, Rarity>(
  Object.values(Rarity).map((r) => [r.toLowerCase(), r]),
);

/**
 * Mirrors Forge's CardRarity.smartValueOf: matches enum name, short code, or
 * long name, case-insensitive. Forge returns Unknown for unknown input; we
 * return null so callers can distinguish "input said Unknown" from "no match".
 */
export const raritySmartValueOf = (input: string): Rarity | null => {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  // Case-insensitive enum-name match (e.g., "MYTHICRARE" or "mythicrare").
  for (const [name, r] of RARITY_BY_NAME) {
    if (name.toLowerCase() === lower) return r;
  }
  const byLong = RARITY_BY_LONG.get(lower);
  if (byLong !== undefined) return byLong;
  const byShort = RARITY_BY_SHORT.get(lower);
  if (byShort !== undefined) return byShort;
  return null;
};

// ---------------------------------------------------------------------------
// TypeLine
// ---------------------------------------------------------------------------

// Reverse lookup: Forge's Supertype.getEnum / CoreType.getEnum are
// case-insensitive maps, so we mirror that behavior for parsing.
const SUPERTYPE_BY_NAME: ReadonlyMap<string, Supertype> = new Map<string, Supertype>(
  Object.values(Supertype).map((s) => [s.toLowerCase(), s]),
);

const CARD_TYPE_BY_NAME: ReadonlyMap<string, CardType> = new Map<string, CardType>(
  Object.values(CardType).map((t) => [t.toLowerCase(), t]),
);

// U+2014 EM DASH is the canonical MTG type-line separator.
// Space-hyphen-space accepted as a fallback for data sources that flatten the
// em-dash to ASCII. Both are normalized to the same split.
const EM_DASH = "—";
const ASCII_SEP = " - ";

interface TypeLineJSON {
  readonly supertypes: Supertype[];
  readonly types: CardType[];
  readonly subtypes: string[];
}

export class TypeLine {
  constructor(
    readonly supertypes: readonly Supertype[],
    readonly types: readonly CardType[],
    readonly subtypes: readonly string[],
  ) {}

  /**
   * Parse a printed type line such as
   *   "Legendary Enchantment Creature — Human Wizard"
   * into its three buckets. Throws on unknown tokens or ambiguous separators.
   */
  static parse(text: string): TypeLine {
    const raw = text.trim();
    if (raw.length === 0) return new TypeLine([], [], []);

    // Normalize ASCII " - " to em-dash for a single split path, but only when
    // exactly one occurrence is present — using replaceAll would mask the
    // multi-separator ambiguity check below.
    let normalized = raw;
    if (!raw.includes(EM_DASH) && raw.includes(ASCII_SEP)) {
      normalized = raw.split(ASCII_SEP).join(EM_DASH);
    }

    const parts = normalized.split(EM_DASH);
    if (parts.length > 2) {
      throw new Error(`TypeLine.parse: multiple type separators in "${text}"`);
    }

    const leftRaw = parts[0] ?? "";
    const rightRaw = parts.length === 2 ? (parts[1] ?? "") : "";

    const leftTokens = leftRaw
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const supertypes: Supertype[] = [];
    const types: CardType[] = [];
    for (const token of leftTokens) {
      const asSuper = SUPERTYPE_BY_NAME.get(token.toLowerCase());
      if (asSuper !== undefined) {
        supertypes.push(asSuper);
        continue;
      }
      const asType = CARD_TYPE_BY_NAME.get(token.toLowerCase());
      if (asType !== undefined) {
        types.push(asType);
        continue;
      }
      throw new Error(`Unknown card type token: ${token}`);
    }

    const subtypes = rightRaw
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    return new TypeLine(supertypes, types, subtypes);
  }

  /** True when the line contains the given supertype or core type. */
  has(t: Supertype | CardType): boolean {
    // Supertype values and CardType values are disjoint string spaces in our
    // rosters, so a single membership check against both arrays is safe.
    return (
      (this.supertypes as readonly string[]).includes(t) || (this.types as readonly string[]).includes(t)
    );
  }

  /** Case-sensitive exact match — subtypes preserve printed casing. */
  hasSubtype(s: string): boolean {
    return this.subtypes.includes(s);
  }

  /** True when any core type on the line is a permanent (per CARD_TYPE_IS_PERMANENT). */
  isPermanent(): boolean {
    return this.types.some(isPermanentType);
  }

  toJSON(): TypeLineJSON {
    return {
      supertypes: [...this.supertypes],
      types: [...this.types],
      subtypes: [...this.subtypes],
    };
  }

  static fromJSON(s: TypeLineJSON): TypeLine {
    return new TypeLine(s.supertypes, s.types, s.subtypes);
  }
}

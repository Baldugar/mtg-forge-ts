// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deck-format legality validators for the major MTG formats.
//
// The format rules and banned/restricted card subsets are derived from
// Forge's `forge-gui/res/formats/Sanctioned/*.txt` data. To keep this module
// self-contained for the MVP, we hard-code a small representative subset of
// the banned/restricted lists rather than loading the full text files at
// runtime. The structure (`BANNED_LISTS`, `RESTRICTED_LISTS`) is data-driven
// so callers can extend or replace the lists wholesale.
//
// References:
//   - MTG Comprehensive Rules 100-104 (deck construction, sideboard).
//   - Forge `DeckFormat.java` and `GameFormat.java`.

/** Identifier for a sanctioned MTG deck-construction format. */
export type FormatId = "standard" | "modern" | "legacy" | "vintage" | "pioneer" | "pauper" | "commander";

/** A single entry in a deck list (mainboard or sideboard). */
export interface DeckEntry {
  /** Card name. Match is case-insensitive. */
  readonly name: string;
  /** Number of copies of this card with this exact name. Must be >= 1. */
  readonly count: number;
  /** Whether this entry belongs to the sideboard. Defaults to false (main). */
  readonly sideboard?: boolean;
  /**
   * Whether this entry is the commander (Commander format only). At most one
   * mainboard entry per deck may carry this flag.
   */
  readonly commander?: boolean;
  /**
   * Optional rarity hint. Used by Pauper to enforce common-only constraint.
   * Values follow Forge's `CardRarity` letter codes: "C" common, "U" uncommon,
   * "R" rare, "M" mythic, "S" special, "L" basic land. Pauper accepts only
   * "C" or "L". When omitted, the rarity check is skipped for that card.
   */
  readonly rarity?: "C" | "U" | "R" | "M" | "S" | "L";
  /**
   * Optional color identity for Commander legality. Values are the canonical
   * single-letter codes ("W", "U", "B", "R", "G"). When omitted on the
   * commander entry, the commander's color identity defaults to colorless.
   */
  readonly colorIdentity?: ReadonlyArray<"W" | "U" | "B" | "R" | "G">;
}

/**
 * Result of a deck legality check.
 *
 * Exported under two names: `DeckValidationResult` (the canonical name used
 * to disambiguate from the card-DSL `ValidationResult` in this package) and
 * `LegalityResult` (a shorter alias). The original spec called this type
 * `ValidationResult`, but that name is already taken by `validate-card.ts`,
 * so this module uses the prefixed names to avoid an export collision.
 */
export interface DeckValidationResult {
  /** True iff `violations` is empty. */
  readonly legal: boolean;
  /** Human-readable list of every rule violated. */
  readonly violations: ReadonlyArray<string>;
}

/** Alias for {@link DeckValidationResult}. */
export type LegalityResult = DeckValidationResult;

// ---------------------------------------------------------------------------
// Basic-land detection
// ---------------------------------------------------------------------------
//
// Basic lands are exempt from the 4-of (and Commander 1-of) restriction.
// Snow-covered basics share the same name minus the "Snow-Covered" prefix
// from a singleton standpoint, but per CR 201 they are distinct cards by
// name; for simplicity we treat both as basics for cap purposes.

const BASIC_LAND_NAMES: ReadonlySet<string> = new Set(
  [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
    "Snow-Covered Plains",
    "Snow-Covered Island",
    "Snow-Covered Swamp",
    "Snow-Covered Mountain",
    "Snow-Covered Forest",
    "Snow-Covered Wastes",
  ].map(normalizeName),
);

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isBasicLand(name: string): boolean {
  return BASIC_LAND_NAMES.has(normalizeName(name));
}

// ---------------------------------------------------------------------------
// Banned / restricted lists
// ---------------------------------------------------------------------------
//
// Representative subsets pulled from Forge's Sanctioned format files. These
// are the bans most unlikely to ever change (power-9 in Vintage, classic
// Modern bans, etc.). Callers needing the full list should swap these maps.
//
// Source: F:/BACKUP/Programacion/forge/forge-gui/res/formats/Sanctioned/*.txt

/** Banned-card lists keyed by format. Names are case-insensitive. */
export const BANNED_LISTS: Readonly<Record<FormatId, ReadonlySet<string>>> = {
  standard: new Set(
    [
      "Cori-Steel Cutter",
      "Heartfire Hero",
      "Hopeless Nightmare",
      "Monstrous Rage",
      "Up the Beanstalk",
      "Vivi Ornitier",
    ].map(normalizeName),
  ),
  modern: new Set(
    [
      "Birthing Pod",
      "Bridge from Below",
      "Chrome Mox",
      "Dark Depths",
      "Deathrite Shaman",
      "Dig Through Time",
      "Eye of Ugin",
      "Field of the Dead",
      "Gitaxian Probe",
      "Hogaak, Arisen Necropolis",
      "Krark-Clan Ironworks",
      "Lurrus of the Dream-Den",
      "Mental Misstep",
      "Mox Opal",
      "Mycosynth Lattice",
      "Oko, Thief of Crowns",
      "Once Upon a Time",
      "Ponder",
      "Sensei's Divining Top",
      "Skullclamp",
      "Splinter Twin",
      "Summer Bloom",
      "The One Ring",
      "Treasure Cruise",
      "Umezawa's Jitte",
      "Uro, Titan of Nature's Wrath",
      "Yorion, Sky Nomad",
    ].map(normalizeName),
  ),
  legacy: new Set(
    [
      "Black Lotus",
      "Channel",
      "Demonic Tutor",
      "Dig Through Time",
      "Earthcraft",
      "Fastbond",
      "Flash",
      "Library of Alexandria",
      "Mana Crypt",
      "Mana Drain",
      "Mana Vault",
      "Mental Misstep",
      "Mishra's Workshop",
      "Mox Emerald",
      "Mox Jet",
      "Mox Pearl",
      "Mox Ruby",
      "Mox Sapphire",
      "Mystical Tutor",
      "Necropotence",
      "Oko, Thief of Crowns",
      "Skullclamp",
      "Sol Ring",
      "Strip Mine",
      "Time Vault",
      "Time Walk",
      "Treasure Cruise",
      "Underworld Breach",
      "Vampiric Tutor",
      "Wrenn and Six",
      "Yawgmoth's Bargain",
      "Yawgmoth's Will",
    ].map(normalizeName),
  ),
  vintage: new Set(
    [
      // Vintage's banned list is dominated by ante/dexterity cards; bans here
      // mirror the small sanctioned subset.
      "Chaos Orb",
      "Falling Star",
      "Shahrazad",
      "Lurrus of the Dream-Den",
    ].map(normalizeName),
  ),
  pioneer: new Set(
    [
      "Balustrade Spy",
      "Expressive Iteration",
      "Felidar Guardian",
      "Field of the Dead",
      "Inverter of Truth",
      "Karn, the Great Creator",
      "Lurrus of the Dream-Den",
      "Nexus of Fate",
      "Oko, Thief of Crowns",
      "Once Upon a Time",
      "Smuggler's Copter",
      "Teferi, Time Raveler",
      "Underworld Breach",
      "Uro, Titan of Nature's Wrath",
      "Veil of Summer",
      "Walking Ballista",
      "Wilderness Reclamation",
      "Winota, Joiner of Forces",
    ].map(normalizeName),
  ),
  pauper: new Set(
    [
      "Arcum's Astrolabe",
      "Atog",
      "Chatterstorm",
      "Cloud of Faeries",
      "Cloudpost",
      "Cranial Plating",
      "Daze",
      "Empty the Warrens",
      "Frantic Search",
      "Gitaxian Probe",
      "Grapeshot",
      "Gush",
      "High Tide",
      "Hymn to Tourach",
      "Invigorate",
      "Monastery Swiftspear",
      "Mystic Sanctuary",
      "Peregrine Drake",
      "Sinkhole",
      "Temporal Fissure",
      "Treasure Cruise",
    ].map(normalizeName),
  ),
  commander: new Set(
    // Commander Rules Committee banned list (representative subset).
    [
      "Ancestral Recall",
      "Balance",
      "Biorhythm",
      "Black Lotus",
      "Channel",
      "Coalition Victory",
      "Dockside Extortionist",
      "Emrakul, the Aeons Torn",
      "Erayo, Soratami Ascendant",
      "Fastbond",
      "Flash",
      "Gifts Ungiven",
      "Griselbrand",
      "Hullbreacher",
      "Iona, Shield of Emeria",
      "Jeweled Lotus",
      "Karakas",
      "Leovold, Emissary of Trest",
      "Library of Alexandria",
      "Limited Resources",
      "Lutri, the Spellchaser",
      "Mana Crypt",
      "Mox Emerald",
      "Mox Jet",
      "Mox Pearl",
      "Mox Ruby",
      "Mox Sapphire",
      "Nadu, Winged Wisdom",
      "Panoptic Mirror",
      "Paradox Engine",
      "Primeval Titan",
      "Prophet of Kruphix",
      "Recurring Nightmare",
      "Rofellos, Llanowar Emissary",
      "Shahrazad",
      "Sundering Titan",
      "Sway of the Stars",
      "Sylvan Primordial",
      "Time Vault",
      "Time Walk",
      "Tinker",
      "Tolarian Academy",
      "Trade Secrets",
      "Upheaval",
      "Worldfire",
      "Yawgmoth's Bargain",
    ].map(normalizeName),
  ),
};

/**
 * Restricted-card lists (1-of cap) keyed by format. Only Vintage uses this
 * in sanctioned MTG; other formats keep an empty set for symmetry.
 */
export const RESTRICTED_LISTS: Readonly<Record<FormatId, ReadonlySet<string>>> = {
  standard: new Set<string>(),
  modern: new Set<string>(),
  legacy: new Set<string>(),
  vintage: new Set(
    [
      "Ancestral Recall",
      "Balance",
      "Black Lotus",
      "Brainstorm",
      "Chalice of the Void",
      "Channel",
      "Demonic Consultation",
      "Demonic Tutor",
      "Dig Through Time",
      "Flash",
      "Gitaxian Probe",
      "Imperial Seal",
      "Karn, the Great Creator",
      "Library of Alexandria",
      "Lion's Eye Diamond",
      "Lodestone Golem",
      "Lotus Petal",
      "Mana Crypt",
      "Mana Vault",
      "Memory Jar",
      "Mental Misstep",
      "Merchant Scroll",
      "Mind's Desire",
      "Monastery Mentor",
      "Mox Emerald",
      "Mox Jet",
      "Mox Pearl",
      "Mox Ruby",
      "Mox Sapphire",
      "Mystic Forge",
      "Mystical Tutor",
      "Narset, Parter of Veils",
      "Necropotence",
      "Sol Ring",
      "Strip Mine",
      "Thorn of Amethyst",
      "Time Vault",
      "Time Walk",
      "Timetwister",
      "Tinker",
      "Tolarian Academy",
      "Treasure Cruise",
      "Trinisphere",
      "Urza's Saga",
      "Vampiric Tutor",
      "Wheel of Fortune",
      "Windfall",
      "Yawgmoth's Will",
    ].map(normalizeName),
  ),
  pioneer: new Set<string>(),
  pauper: new Set<string>(),
  commander: new Set<string>(),
};

// ---------------------------------------------------------------------------
// Format rule descriptors
// ---------------------------------------------------------------------------

interface FormatRules {
  readonly minMain: number;
  readonly maxMain: number | null;
  readonly maxSideboard: number;
  readonly copyCap: number;
  /** True for Commander: 1-of singleton (basics excluded). */
  readonly singleton: boolean;
  /** True for Pauper: only common/basic-land rarities are legal. */
  readonly commonOnly: boolean;
  /** True for Commander: requires a designated commander entry. */
  readonly requiresCommander: boolean;
}

const FORMAT_RULES: Readonly<Record<FormatId, FormatRules>> = {
  standard: {
    minMain: 60,
    maxMain: null,
    maxSideboard: 15,
    copyCap: 4,
    singleton: false,
    commonOnly: false,
    requiresCommander: false,
  },
  modern: {
    minMain: 60,
    maxMain: null,
    maxSideboard: 15,
    copyCap: 4,
    singleton: false,
    commonOnly: false,
    requiresCommander: false,
  },
  legacy: {
    minMain: 60,
    maxMain: null,
    maxSideboard: 15,
    copyCap: 4,
    singleton: false,
    commonOnly: false,
    requiresCommander: false,
  },
  vintage: {
    minMain: 60,
    maxMain: null,
    maxSideboard: 15,
    copyCap: 4,
    singleton: false,
    commonOnly: false,
    requiresCommander: false,
  },
  pioneer: {
    minMain: 60,
    maxMain: null,
    maxSideboard: 15,
    copyCap: 4,
    singleton: false,
    commonOnly: false,
    requiresCommander: false,
  },
  pauper: {
    minMain: 60,
    maxMain: null,
    maxSideboard: 15,
    copyCap: 4,
    singleton: false,
    commonOnly: true,
    requiresCommander: false,
  },
  commander: {
    minMain: 100,
    maxMain: 100,
    maxSideboard: 0,
    copyCap: 1,
    singleton: true,
    commonOnly: false,
    requiresCommander: true,
  },
};

// ---------------------------------------------------------------------------
// validateDeck
// ---------------------------------------------------------------------------

/**
 * Validate a deck against the rules of the given sanctioned format.
 *
 * The check covers:
 *   - mainboard size (min/max),
 *   - sideboard size cap,
 *   - copy cap (4-of standard, 1-of singleton for Commander),
 *   - banned-card list (`BANNED_LISTS`),
 *   - restricted-card list (`RESTRICTED_LISTS`, Vintage 1-of),
 *   - Pauper common-only rarity (when `rarity` is supplied),
 *   - Commander requires exactly one designated commander, and color-identity
 *     compliance (when `colorIdentity` is supplied on each card).
 *
 * Set legality is intentionally out of scope for the MVP; supplying that
 * data per-card would require shipping the full Sanctioned set list.
 *
 * @param deck   list of mainboard + sideboard entries
 * @param format the sanctioned format to check against
 * @returns      `{ legal, violations }`. `legal` iff `violations` is empty.
 */
export function validateDeck(deck: readonly DeckEntry[], format: FormatId): DeckValidationResult {
  const rules = FORMAT_RULES[format];
  if (rules === undefined) {
    return {
      legal: false,
      violations: [`Unknown format: ${String(format)}`],
    };
  }

  const violations: string[] = [];

  // Reject malformed entries up front. We continue accumulating other
  // violations to produce a useful aggregate report.
  for (const entry of deck) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      violations.push(`Invalid count ${String(entry.count)} for "${entry.name}"`);
    }
  }

  // Aggregate counts across duplicate entries with the same name. Mainboard
  // and sideboard count toward the same per-card cap (CR 100.4 / Forge
  // convention: 4 copies max across main+sideboard combined).
  const main: DeckEntry[] = [];
  const side: DeckEntry[] = [];
  for (const entry of deck) {
    (entry.sideboard === true ? side : main).push(entry);
  }

  const mainSize = sumCounts(main);
  const sideSize = sumCounts(side);

  if (mainSize < rules.minMain) {
    violations.push(
      `Mainboard has ${String(mainSize)} cards; format ${format} requires at least ${String(rules.minMain)}`,
    );
  }
  if (rules.maxMain !== null && mainSize > rules.maxMain) {
    violations.push(
      `Mainboard has ${String(mainSize)} cards; format ${format} requires exactly ${String(rules.maxMain)}`,
    );
  }
  if (sideSize > rules.maxSideboard) {
    violations.push(
      `Sideboard has ${String(sideSize)} cards; format ${format} allows at most ${String(rules.maxSideboard)}`,
    );
  }

  // Per-card aggregate (main + sideboard) for copy-cap and ban checks.
  const totals = aggregateByName(deck);

  const banned = BANNED_LISTS[format];
  const restricted = RESTRICTED_LISTS[format];

  for (const [normalized, info] of totals) {
    const display = info.displayName;

    if (banned.has(normalized)) {
      violations.push(`Banned in ${format}: "${display}"`);
    }

    if (restricted.has(normalized) && info.total > 1) {
      violations.push(`Restricted (max 1) in ${format}: "${display}" has ${String(info.total)} copies`);
    }

    if (rules.singleton) {
      if (!isBasicLand(display) && info.total > rules.copyCap) {
        violations.push(
          `Singleton violation in ${format}: "${display}" has ${String(info.total)} copies (max ${String(rules.copyCap)})`,
        );
      }
    } else if (
      !isBasicLand(display) &&
      !restricted.has(normalized) && // restricted already reported above
      info.total > rules.copyCap
    ) {
      violations.push(
        `Too many copies in ${format}: "${display}" has ${String(info.total)} (max ${String(rules.copyCap)})`,
      );
    }

    if (rules.commonOnly && info.rarity !== undefined) {
      if (info.rarity !== "C" && info.rarity !== "L") {
        violations.push(`Pauper allows only commons: "${display}" rarity ${info.rarity}`);
      }
    }
  }

  // Commander-specific: exactly one designated commander, color identity
  // compliance for the rest of the deck.
  if (rules.requiresCommander) {
    const commanders = deck.filter((e) => e.commander === true && e.sideboard !== true);
    if (commanders.length === 0) {
      violations.push("Commander format requires a designated commander");
    } else if (commanders.length > 1) {
      // Partner / Background pairs are out of scope for the MVP.
      violations.push(`Commander format allows at most one commander (got ${String(commanders.length)})`);
    } else {
      const cmdr = commanders[0];
      if (cmdr === undefined) {
        // Unreachable: length === 1 was just verified above. Narrowing only.
        return { legal: violations.length === 0, violations };
      }
      const ci = new Set(cmdr.colorIdentity ?? []);
      for (const entry of deck) {
        if (entry === cmdr || entry.sideboard === true) continue;
        if (entry.colorIdentity === undefined) continue;
        for (const color of entry.colorIdentity) {
          if (!ci.has(color)) {
            violations.push(
              `Color-identity violation: "${entry.name}" includes ${color} not in commander's identity`,
            );
            break;
          }
        }
      }
    }
  }

  return { legal: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sumCounts(entries: readonly DeckEntry[]): number {
  let total = 0;
  for (const e of entries) {
    if (Number.isInteger(e.count) && e.count > 0) total += e.count;
  }
  return total;
}

interface AggregatedCard {
  total: number;
  displayName: string;
  rarity?: DeckEntry["rarity"];
}

function aggregateByName(deck: readonly DeckEntry[]): Map<string, AggregatedCard> {
  const out = new Map<string, AggregatedCard>();
  for (const entry of deck) {
    if (!Number.isInteger(entry.count) || entry.count < 1) continue;
    const key = normalizeName(entry.name);
    const existing = out.get(key);
    if (existing === undefined) {
      out.set(key, {
        total: entry.count,
        displayName: entry.name,
        rarity: entry.rarity,
      });
    } else {
      existing.total += entry.count;
      // Prefer the first non-undefined rarity we see.
      if (existing.rarity === undefined && entry.rarity !== undefined) {
        existing.rarity = entry.rarity;
      }
    }
  }
  return out;
}

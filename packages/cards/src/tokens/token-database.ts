// SPDX-License-Identifier: GPL-3.0-or-later
// Token database — predefined token entries indexed by Forge's snake_case
// `TokenScript$` identifier (e.g. `w_1_1_soldier`, `c_a_treasure_sac`).
//
// Forge stores tokens as standalone card files under
// `forge-gui/res/tokenscripts/`. The script name encodes the token shape:
//
//   colors_power_toughness_cardtypes_subtypes_keywords
//
// Examples (taken verbatim from Forge):
//   w_1_1_soldier                  → white 1/1 Soldier creature
//   c_1_1_a_servo                  → colorless 1/1 Servo artifact creature
//   c_a_treasure_sac               → colorless Treasure artifact (mana-sac ability)
//   wb_1_1_human_cleric            → white-black 1/1 Human Cleric creature
//
// This database is the runtime mirror of the subset of `tokenscripts/`
// referenced by cards in scope for SP3/SP4. Each entry is shape-only data
// used by `TokenEffect` to synthesise a `PaperCard` at resolve time.
//
// We intentionally hand-roll the entries (rather than parse the text files
// at startup) so the database is a pure deterministic value with no I/O
// dependency. Entries are the canonical 1/1 Soldier, 1/1 Saproling, etc.
// plus the artifact-token quartet (Treasure / Food / Clue / Blood /
// Powerstone) that real Forge cards reference via `TokenScript$`.
//
// Scope MVP:
//   - Pure cosmetic shape (name / types / PT / colors / keywords).
//   - Activated abilities on the artifact tokens are stubbed as `[]` for
//     this batch: Wave 1 of TokenScript$ resolution focuses on getting the
//     shape correct so cards that read "create a Treasure token" no longer
//     fail validation. The activated ability text is kept in the entry's
//     `oracle` so UIs can display it; engine wiring of the abilities is
//     deferred to a follow-up wave once `parseCard` is reachable from
//     here without circular dependency concerns.
import { CardType, Color, ColorSet, TypeLine, keywordIdFromDisplayName } from "@mtg-forge-ts/core";
import type {
  ColorSet as ColorSetType,
  KeywordAst,
  Supertype,
  TypeLine as TypeLineType,
} from "@mtg-forge-ts/core";

// ---------------------------------------------------------------------------
// Public TokenEntry shape
// ---------------------------------------------------------------------------

export interface TokenEntry {
  /** Forge `TokenScript$` identifier (snake_case). */
  readonly id: string;
  /** Printed token name (e.g. "Soldier Token", "Treasure Token"). */
  readonly name: string;
  /** Parsed type line (supertypes / types / subtypes). */
  readonly types: TypeLineType;
  /** Optional P/T pair. Non-creature tokens (Treasure et al.) omit this. */
  readonly pt?: { power: string; toughness: string };
  /** Color identity. Colorless tokens use `ColorSet.empty()`. */
  readonly colors: ColorSetType;
  /**
   * Tokens have no mana cost; this field is here only so TokenEntry mirrors
   * the `CardDefinition` shape used downstream. Always `null`.
   */
  readonly manaCost: null;
  /** Static keywords printed on the token (Flying, Vigilance, Decayed, …). */
  readonly keywords: readonly KeywordAst[];
  /**
   * Activated / triggered abilities. MVP: empty for shape-only tokens;
   * artifact tokens that need Mana / Draw / GainLife abilities will be
   * wired in a follow-up wave once the parser is reachable here.
   */
  readonly abilities: readonly unknown[];
  /** Printed reminder text (UI display only). */
  readonly oracle: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NO_SUPERTYPES: readonly Supertype[] = [];

const kw = (display: string): KeywordAst => {
  const id = keywordIdFromDisplayName(display);
  if (id === null) throw new Error(`token-database: unknown keyword "${display}"`);
  return { keyword: id };
};

const types = (typesAndSubs: string): TypeLineType => {
  // Forge's tokenscripts use a space-separated single line like
  //   "Artifact Creature Servo" (no em dash). Split into primaries vs
  // subtypes ourselves so the result matches what `TypeLine.parse` would
  // emit if the source had used the printed em-dash form.
  const tokens = typesAndSubs.split(/\s+/).filter((t) => t.length > 0);
  const primaryTypeNames = new Set(Object.values(CardType).map((t) => t.toLowerCase()));
  const primaryTypes: CardType[] = [];
  const subtypes: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (primaryTypeNames.has(lower)) {
      // Match TypeLine's CardType enum value (which is title-cased).
      const enumVal = Object.values(CardType).find((c) => c.toLowerCase() === lower);
      if (enumVal !== undefined) primaryTypes.push(enumVal);
    } else {
      subtypes.push(t);
    }
  }
  return new TypeLine(NO_SUPERTYPES, primaryTypes, subtypes);
};

const colorsOf = (...cs: readonly Color[]): ColorSetType =>
  cs.length === 0 ? ColorSet.empty() : ColorSet.of(...cs);

const W = Color.White;
const U = Color.Blue;
const B = Color.Black;
const R = Color.Red;
const G = Color.Green;

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const entries: readonly TokenEntry[] = [
  // --- mono-white creatures ---
  {
    id: "w_1_1_soldier",
    name: "Soldier Token",
    types: types("Creature Soldier"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(W),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "w_1_1_soldier_lifelink",
    name: "Soldier Token",
    types: types("Creature Soldier"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(W),
    manaCost: null,
    keywords: [kw("Lifelink")],
    abilities: [],
    oracle: "Lifelink",
  },
  {
    id: "w_1_1_spirit_flying",
    name: "Spirit Token",
    types: types("Creature Spirit"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(W),
    manaCost: null,
    keywords: [kw("Flying")],
    abilities: [],
    oracle: "Flying",
  },
  {
    id: "w_2_2_knight",
    name: "Knight Token",
    types: types("Creature Knight"),
    pt: { power: "2", toughness: "2" },
    colors: colorsOf(W),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "w_2_2_knight_vigilance",
    name: "Knight Token",
    types: types("Creature Knight"),
    pt: { power: "2", toughness: "2" },
    colors: colorsOf(W),
    manaCost: null,
    keywords: [kw("Vigilance")],
    abilities: [],
    oracle: "Vigilance",
  },
  {
    id: "w_1_1_human_soldier",
    name: "Human Soldier Token",
    types: types("Creature Human Soldier"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(W),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },

  // --- mono-blue creatures ---
  {
    id: "u_1_1_bird_flying",
    name: "Bird Token",
    types: types("Creature Bird"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(U),
    manaCost: null,
    keywords: [kw("Flying")],
    abilities: [],
    oracle: "Flying",
  },
  {
    id: "u_2_1_ninja",
    name: "Ninja Token",
    types: types("Creature Ninja"),
    pt: { power: "2", toughness: "1" },
    colors: colorsOf(U),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },

  // --- mono-black creatures ---
  {
    id: "b_2_2_zombie",
    name: "Zombie Token",
    types: types("Creature Zombie"),
    pt: { power: "2", toughness: "2" },
    colors: colorsOf(B),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "b_2_2_zombie_decayed",
    name: "Zombie Token",
    types: types("Creature Zombie"),
    pt: { power: "2", toughness: "2" },
    colors: colorsOf(B),
    manaCost: null,
    keywords: [kw("Decayed")],
    abilities: [],
    oracle: "Decayed",
  },
  {
    id: "b_1_1_skeleton",
    name: "Skeleton Token",
    types: types("Creature Skeleton"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(B),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "b_4_4_horror",
    name: "Horror Token",
    types: types("Creature Horror"),
    pt: { power: "4", toughness: "4" },
    colors: colorsOf(B),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "b_5_5_zombie_giant",
    name: "Zombie Giant Token",
    types: types("Creature Zombie Giant"),
    pt: { power: "5", toughness: "5" },
    colors: colorsOf(B),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "b_1_1_rat",
    name: "Rat Token",
    types: types("Creature Rat"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(B),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },

  // --- mono-red creatures ---
  {
    id: "r_1_1_goblin",
    name: "Goblin Token",
    types: types("Creature Goblin"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(R),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "r_3_1_elemental",
    name: "Elemental Token",
    types: types("Creature Elemental"),
    pt: { power: "3", toughness: "1" },
    colors: colorsOf(R),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "r_5_5_dragon_flying",
    name: "Dragon Token",
    types: types("Creature Dragon"),
    pt: { power: "5", toughness: "5" },
    colors: colorsOf(R),
    manaCost: null,
    keywords: [kw("Flying")],
    abilities: [],
    oracle: "Flying",
  },
  {
    id: "r_4_4_dragon_flying",
    name: "Dragon Token",
    types: types("Creature Dragon"),
    pt: { power: "4", toughness: "4" },
    colors: colorsOf(R),
    manaCost: null,
    keywords: [kw("Flying")],
    abilities: [],
    oracle: "Flying",
  },

  // --- mono-green creatures ---
  {
    id: "g_1_1_saproling",
    name: "Saproling Token",
    types: types("Creature Saproling"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(G),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "g_3_3_beast",
    name: "Beast Token",
    types: types("Creature Beast"),
    pt: { power: "3", toughness: "3" },
    colors: colorsOf(G),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "g_1_1_elf_warrior",
    name: "Elf Warrior Token",
    types: types("Creature Elf Warrior"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(G),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "g_2_2_wolf",
    name: "Wolf Token",
    types: types("Creature Wolf"),
    pt: { power: "2", toughness: "2" },
    colors: colorsOf(G),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "g_1_1_snake_deathtouch",
    name: "Snake Token",
    types: types("Creature Snake"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(G),
    manaCost: null,
    keywords: [kw("Deathtouch")],
    abilities: [],
    oracle: "Deathtouch",
  },
  {
    id: "g_1_1_frog",
    name: "Frog Token",
    types: types("Creature Frog"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(G),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },

  // --- multicolor creatures ---
  {
    id: "wb_1_1_human_cleric",
    name: "Human Cleric Token",
    types: types("Creature Human Cleric"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(W, B),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "gw_1_1_citizen",
    name: "Citizen Token",
    types: types("Creature Citizen"),
    pt: { power: "1", toughness: "1" },
    colors: colorsOf(G, W),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "rw_3_2_spirit",
    name: "Spirit Token",
    types: types("Creature Spirit"),
    pt: { power: "3", toughness: "2" },
    colors: colorsOf(R, W),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },

  // --- colorless artifact creatures ---
  {
    id: "c_1_1_a_servo",
    name: "Servo Token",
    types: types("Artifact Creature Servo"),
    pt: { power: "1", toughness: "1" },
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "c_1_1_a_thopter_flying",
    name: "Thopter Token",
    types: types("Artifact Creature Thopter"),
    pt: { power: "1", toughness: "1" },
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [kw("Flying")],
    abilities: [],
    oracle: "Flying",
  },
  {
    id: "c_1_1_a_construct",
    name: "Construct Token",
    types: types("Artifact Creature Construct"),
    pt: { power: "1", toughness: "1" },
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },
  {
    id: "c_3_3_e_a_golem",
    name: "Golem Token",
    types: types("Enchantment Artifact Creature Golem"),
    pt: { power: "3", toughness: "3" },
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "",
  },

  // --- non-creature artifact tokens (Treasure / Food / Clue / Blood / Powerstone) ---
  // Activated abilities are intentionally empty for MVP — see file header.
  {
    id: "c_a_treasure_sac",
    name: "Treasure Token",
    types: types("Artifact Treasure"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "{T}, Sacrifice this token: Add one mana of any color.",
  },
  {
    id: "c_a_food_sac",
    name: "Food Token",
    types: types("Artifact Food"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "{2}, {T}, Sacrifice this token: You gain 3 life.",
  },
  {
    id: "c_a_clue_draw",
    name: "Clue Token",
    types: types("Artifact Clue"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "{2}, Sacrifice this token: Draw a card.",
  },
  {
    id: "c_a_blood_draw",
    name: "Blood Token",
    types: types("Artifact Blood"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.",
  },
  {
    id: "c_a_powerstone",
    name: "Powerstone Token",
    types: types("Artifact Powerstone"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [],
    oracle: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const buildDb = (): ReadonlyMap<string, TokenEntry> => {
  const m = new Map<string, TokenEntry>();
  for (const e of entries) {
    if (m.has(e.id)) {
      throw new Error(`token-database: duplicate id "${e.id}"`);
    }
    m.set(e.id, e);
  }
  return m;
};

/** Indexed read-only view of every predefined token entry. */
export const tokenDatabase: ReadonlyMap<string, TokenEntry> = buildDb();

/** Look up a token entry by `TokenScript$` identifier; `undefined` when absent. */
export const lookupTokenScript = (id: string): TokenEntry | undefined => tokenDatabase.get(id);

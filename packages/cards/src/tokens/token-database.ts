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
//   - Wave 17b — the artifact-token quartet (Treasure / Food / Clue / Blood)
//     plus Powerstone now carry hand-rolled activated AbilityAst entries
//     so the tokens can actually be activated once they enter play. We
//     emit AbilityAst directly (rather than running `parseCard` here) to
//     keep this database a pure deterministic value with no parser
//     dependency.
import { CardType, Color, ColorSet, TypeLine, keywordIdFromDisplayName } from "@mtg-forge-ts/core";
import type {
  AbilityAst,
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
   * Activated / triggered abilities. Wave 17b — artifact tokens carry
   * hand-rolled `AbilityAst` entries; pure cosmetic creature tokens leave
   * this empty. The runtime `Card.activateAbilitiesFromDefinition()` walks
   * this list to construct live SpellAbility instances at token-creation.
   */
  readonly abilities: readonly AbilityAst[];
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
// Activated-ability builders for the artifact-token quartet (Wave 17b)
// ---------------------------------------------------------------------------
//
// Hand-rolled AbilityAst entries that mirror Forge's `tokenscripts/` source.
// We emit the AST directly rather than reaching for `parseCard`: the cards
// package is the parser package, so calling parseCard from inside its own
// data layer would create a circular initialisation. Each builder produces
// the same shape the parser would emit for the corresponding `A:` line.

const lit = (raw: string): { kind: "literal"; raw: string } => ({ kind: "literal", raw });

/** Treasure: `{T}, Sacrifice this token: Add one mana of any color.` */
const treasureSacAbility = (): AbilityAst => ({
  kind: "activated",
  effect: {
    handlerKey: "Mana",
    params: { Produced: lit("Any"), Amount: lit("1") },
  },
  cost: { raw: "T, Sacrifice CARDNAME" },
});

/** Food: `{2}, {T}, Sacrifice this token: You gain 3 life.` */
const foodSacAbility = (): AbilityAst => ({
  kind: "activated",
  effect: {
    handlerKey: "GainLife",
    params: { LifeAmount: lit("3"), Defined: lit("You") },
  },
  cost: { raw: "2, T, Sacrifice CARDNAME" },
});

/** Clue: `{2}, Sacrifice this token: Draw a card.` */
const clueDrawAbility = (): AbilityAst => ({
  kind: "activated",
  effect: {
    handlerKey: "Draw",
    params: { NumCards: lit("1"), Defined: lit("You") },
  },
  cost: { raw: "2, Sacrifice CARDNAME" },
});

/**
 * Blood: `{1}, {T}, Discard a card, Sacrifice this token: Draw a card.`
 *
 * MVP: the cost-payment grammar only models self-discard ("Discard
 * CARDNAME"), not "Discard a card" target-selection. We omit the discard
 * segment from the cost so the ability is activatable; oracle text on the
 * entry preserves the full printed text. Wave 18 wires the discard-target
 * decision yield and restores the canonical cost.
 */
const bloodDrawAbility = (): AbilityAst => ({
  kind: "activated",
  effect: {
    handlerKey: "Draw",
    params: { NumCards: lit("1"), Defined: lit("You") },
  },
  cost: { raw: "1, T, Sacrifice CARDNAME" },
});

/** Powerstone: `{T}: Add {C}.` (spend-restriction pending — see entry comment). */
const powerstoneManaAbility = (): AbilityAst => ({
  kind: "activated",
  effect: {
    handlerKey: "Mana",
    params: { Produced: lit("C"), Amount: lit("1") },
  },
  cost: { raw: "T" },
});

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
  // Activated abilities are hand-rolled AbilityAst entries (Wave 17b).
  {
    id: "c_a_treasure_sac",
    name: "Treasure Token",
    types: types("Artifact Treasure"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [treasureSacAbility()],
    oracle: "{T}, Sacrifice this token: Add one mana of any color.",
  },
  {
    id: "c_a_food_sac",
    name: "Food Token",
    types: types("Artifact Food"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [foodSacAbility()],
    oracle: "{2}, {T}, Sacrifice this token: You gain 3 life.",
  },
  {
    id: "c_a_clue_draw",
    name: "Clue Token",
    types: types("Artifact Clue"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [clueDrawAbility()],
    oracle: "{2}, Sacrifice this token: Draw a card.",
  },
  {
    id: "c_a_blood_draw",
    name: "Blood Token",
    types: types("Artifact Blood"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [bloodDrawAbility()],
    // Forge's printed Blood text includes a "Discard a card" cost segment;
    // the engine's Discard cost-part currently only models self-discard,
    // so MVP omits the discard segment from the activatable cost. The
    // oracle line below preserves the full printed text for UI display.
    oracle: "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.",
  },
  {
    id: "c_a_powerstone",
    name: "Powerstone Token",
    types: types("Artifact Powerstone"),
    colors: ColorSet.empty(),
    manaCost: null,
    keywords: [],
    abilities: [powerstoneManaAbility()],
    // TODO(spend-restriction): {C} mana from a Powerstone can't be spent on
    // creature spells / activated abilities of creature sources (CR
    // 107.4d). The cost-payment solver does not yet honour ManaProduced
    // restrictions on activated abilities, so MVP emits unrestricted {C}.
    // Track via Wave 18 when the solver gains restriction-aware filtering.
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

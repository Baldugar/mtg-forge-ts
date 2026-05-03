// SPDX-License-Identifier: GPL-3.0-or-later
// TokenEffect — creates tokens by either:
//   (a) looking up a predefined entry in the token database (`TokenScript$`
//       form), or
//   (b) synthesizing a PaperCard from inline DSL parameters (`TokenName$`,
//       `TokenPower$`, `TokenToughness$`, `TokenTypes$`, `TokenColors$`,
//       `TokenKeywords$`, `TokenAmount$`).
//
// `TokenAmount$` and other count-modifying parameters apply to both forms.
//
// Forge DSL examples:
//   A:SP$ Token | TokenAmount$ 1 | TokenPower$ 3 | TokenToughness$ 1
//     | TokenName$ Elemental | TokenTypes$ Creature,Elemental
//     | TokenColors$ Red | TokenKeywords$ Haste
//   A:AB$ Token | Cost$ 1 W | TokenScript$ w_1_1_soldier
//   SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ w_1_1_spirit_flying
import { tokenDatabase } from "@mtg-forge-ts/cards";
import type { TokenEntry } from "@mtg-forge-ts/cards";
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  TypeLine,
  keywordIdFromDisplayName,
} from "@mtg-forge-ts/core";
import type { CardDefinition, CounterType, PaperCard, Supertype } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// ---------------------------------------------------------------------------
// Inline PaperCard synthesis
// ---------------------------------------------------------------------------

/** Parse a comma/space-separated color list ("Red", "Green,Blue") → ColorSet. */
const parseTokenColors = (raw: string): ColorSet => {
  if (!raw.trim()) return ColorSet.empty();
  const colors: Color[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const lower = part.trim().toLowerCase();
    switch (lower) {
      case "white":
        colors.push(Color.White);
        break;
      case "blue":
        colors.push(Color.Blue);
        break;
      case "black":
        colors.push(Color.Black);
        break;
      case "red":
        colors.push(Color.Red);
        break;
      case "green":
        colors.push(Color.Green);
        break;
      default:
        break; // unknown color token — skip silently
    }
  }
  return ColorSet.of(...colors);
};

/** Parse comma-separated keyword display names → array of keyword id strings. */
const parseTokenKeywords = (raw: string): readonly unknown[] => {
  if (!raw.trim()) return [];
  const ids: unknown[] = [];
  for (const part of raw.split(/[,&]+/)) {
    const name = part.trim();
    if (!name) continue;
    const id = keywordIdFromDisplayName(name);
    if (id !== null) {
      // Store as a minimal keyword AST understood downstream (plain string id).
      ids.push(id);
    }
  }
  return ids;
};

/**
 * Build a minimal PaperCard for a token from inline DSL parameters.
 * `typesRaw` is comma-separated type names, e.g. "Creature,Elemental".
 * TypeLine.parse needs the "Supertype Type — Subtype" format; we
 * reconstruct it by separating primary types from subtypes ourselves.
 */
const PRIMARY_CARD_TYPES: ReadonlySet<string> = new Set(Object.values(CardType).map((t) => t.toLowerCase()));

const synthesizeTokenPaperCard = (opts: {
  name: string;
  power: string;
  toughness: string;
  typesRaw: string;
  colorsRaw: string;
  keywordsRaw: string;
}): PaperCard => {
  const { name, power, toughness, typesRaw, colorsRaw, keywordsRaw } = opts;

  // Split the comma-separated type list into primary types vs subtypes.
  const typeTokens = typesRaw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const primaryTokens: string[] = [];
  const subtypeTokens: string[] = [];
  for (const tok of typeTokens) {
    if (PRIMARY_CARD_TYPES.has(tok.toLowerCase())) {
      primaryTokens.push(tok);
    } else {
      subtypeTokens.push(tok);
    }
  }

  // TypeLine.parse expects "Type — Subtype" format (em dash). Build that string.
  const typeLineText =
    subtypeTokens.length > 0
      ? `${primaryTokens.join(" ")} — ${subtypeTokens.join(" ")}`
      : primaryTokens.join(" ");
  const typeLine = typeLineText.trim()
    ? TypeLine.parse(typeLineText)
    : new TypeLine([] as Supertype[], [], []);

  const colors = parseTokenColors(colorsRaw);
  const keywords = parseTokenKeywords(keywordsRaw);

  const definition: CardDefinition = {
    name,
    oracle: "",
    types: typeLine,
    manaCost: null,
    pt: { power, toughness },
    colors,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords,
    svars: new Map(),
  };

  const paperCard: PaperCard = {
    name,
    // Use a synthetic set code + collector number so token PaperCards are
    // distinguishable in the inventory layer without conflicting with real sets.
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };

  return paperCard;
};

// ---------------------------------------------------------------------------
// PaperCard synthesis from a TokenEntry
// ---------------------------------------------------------------------------

/**
 * Build a PaperCard from a `TokenEntry` (the `TokenScript$` form). Mirrors
 * `synthesizeTokenPaperCard` for the inline form but reads pre-parsed
 * structural fields off the entry instead of parsing strings.
 */
const paperCardFromEntry = (entry: TokenEntry): PaperCard => {
  const definition: CardDefinition = {
    name: entry.name,
    oracle: entry.oracle,
    types: entry.types,
    manaCost: entry.manaCost,
    ...(entry.pt !== undefined ? { pt: entry.pt } : {}),
    colors: entry.colors,
    abilities: entry.abilities,
    triggers: [],
    replacements: [],
    statics: [],
    keywords: entry.keywords,
    svars: new Map(),
  };
  return {
    name: entry.name,
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

/**
 * Fallback synthesizer: parse a Forge token-id string and build a PaperCard
 * if the id follows Forge's naming convention. Returns null if the id is too
 * exotic for the heuristic; caller falls back to the unknown-token error.
 *
 * Convention: `<colors>_<power>_<toughness>_<subtype1>[_<subtype2>...][_<keyword>...]`
 *   - `<colors>` is one of `c` (colorless), `w/u/b/r/g`, multi-color combos
 *     (`wb`, `bg`, `rg`, etc.), `m` (multi).
 *   - `<power>` and `<toughness>` are integers or `x` for variable.
 *   - Remaining underscore-separated tokens are subtypes; some are keywords
 *     baked into known suffixes (`flying`, `hexproof`, `lifelink`, etc.).
 *   - An `a` token between colors and stats means Artifact (e.g.
 *     `c_1_1_a_servo`).
 */
const COLOR_LETTER_TO_COLOR: ReadonlyMap<string, Color> = new Map([
  ["w", Color.White],
  ["u", Color.Blue],
  ["b", Color.Black],
  ["r", Color.Red],
  ["g", Color.Green],
]);
const KEYWORD_SUFFIXES: ReadonlySet<string> = new Set([
  "flying",
  "vigilance",
  "trample",
  "haste",
  "lifelink",
  "deathtouch",
  "hexproof",
  "menace",
  "reach",
  "first",
  "double",
  "shroud",
  "indestructible",
  "defender",
  "tappump",
]);

const synthesizeFromId = (id: string): PaperCard | null => {
  const parts = id.split("_");
  if (parts.length < 4) return null;
  const colorPart = parts[0];
  const powerPart = parts[1];
  const toughnessPart = parts[2];
  if (!colorPart || !powerPart || !toughnessPart) return null;
  // Validate color part: single char from c/w/u/b/r/g/m, or multi-char from same set.
  const colors: Color[] = [];
  if (colorPart === "c" || colorPart === "m") {
    // colorless or multi (Forge sometimes uses m for multicolor) — leave empty
  } else {
    for (const ch of colorPart) {
      const c = COLOR_LETTER_TO_COLOR.get(ch);
      if (c === undefined) return null;
      colors.push(c);
    }
  }
  // Power/toughness validation.
  if (!/^(\d+|x)$/i.test(powerPart) || !/^(\d+|x)$/i.test(toughnessPart)) return null;
  const remaining = parts.slice(3);
  // Optional 'a' marker for Artifact creatures.
  let isArtifact = false;
  if (remaining[0] === "a") {
    isArtifact = true;
    remaining.shift();
  }
  // Split remaining into subtypes vs keywords by suffix lookup. Anything not in
  // the keyword set is a subtype.
  const subtypes: string[] = [];
  const keywordIds: unknown[] = [];
  for (const tok of remaining) {
    if (KEYWORD_SUFFIXES.has(tok)) {
      const id = keywordIdFromDisplayName(
        tok === "first"
          ? "First Strike"
          : tok === "double"
            ? "Double Strike"
            : tok.charAt(0).toUpperCase() + tok.slice(1),
      );
      if (id !== null) keywordIds.push(id);
    } else {
      subtypes.push(tok.charAt(0).toUpperCase() + tok.slice(1));
    }
  }
  // Build the type line: optionally Artifact + Creature + subtypes.
  const primaryTypes = isArtifact ? "Artifact Creature" : "Creature";
  const subtypeStr = subtypes.join(" ");
  const typeLineText = subtypeStr.length > 0 ? `${primaryTypes} — ${subtypeStr}` : primaryTypes;
  const typeLine = TypeLine.parse(typeLineText);
  const colorSet = ColorSet.of(...colors);
  const name = subtypes.length > 0 ? `${subtypes.join(" ")} Token` : "Token";
  const definition: CardDefinition = {
    name,
    oracle: "",
    types: typeLine,
    manaCost: null,
    pt: {
      power: powerPart === "x" ? "0" : powerPart,
      toughness: toughnessPart === "x" ? "0" : toughnessPart,
    },
    colors: colorSet,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: keywordIds,
    svars: new Map(),
  };
  return {
    name,
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

// ---------------------------------------------------------------------------
// TokenEffect
// ---------------------------------------------------------------------------

/**
 * Parse a `WithCounters$` payload of the form `<Type>:<N>` (or just `<Type>`,
 * which defaults to N=1). Returns null if unparsable.
 */
const parseWithCounters = (raw: string): { ct: CounterType; n: number } | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [head, tail] = trimmed.split(":");
  if (!head) return null;
  const n = tail !== undefined ? Number(tail) : 1;
  if (!Number.isFinite(n) || n <= 0) return null;
  return { ct: head as CounterType, n };
};

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

export class TokenEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Token";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const count = hasParam(sa, "TokenAmount") ? evaluateParamNumber(sa, "TokenAmount", game) : 1;
    // M6.16 — Forge no-ops when count is 0 (X-cost tokens with X=0,
    // count-by-board with no matches). The action layer rejects 0 with
    // an IllegalDecisionError, so we early-return before hitting it
    // rather than treating "no tokens" as a runtime failure.
    if (count <= 0) return;

    // ---- Build the PaperCard (TokenScript$ vs inline form) -------------
    // CR 113.1d / Forge — TokenScript$ may be comma-separated (e.g.
    // "w_1_1_human,u_1_1_merfolk,r_1_1_goblin") to mint one token per
    // entry. Each entry resolves independently against the token database;
    // we loop over them and create each token. Common pattern in
    // multi-token-creating spells like A Killer Among Us, Stitch Together,
    // Captive Audience, Wedding Ring, etc.
    let paperCards: PaperCard[];
    if (hasParam(sa, "TokenScript")) {
      const raw = evaluateParamRaw(sa, "TokenScript").trim();
      const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      paperCards = [];
      for (const id of ids) {
        const entry = tokenDatabase.get(id);
        if (entry !== undefined) {
          paperCards.push(paperCardFromEntry(entry));
          continue;
        }
        // Fall back to parsing the id by Forge's naming convention:
        //   <colors>_<power>_<toughness>_<subtype1>[_<subtype2>...][_<keyword>...]
        // e.g. "w_1_1_soldier", "rg_2_2_human_warrior", "c_1_1_a_servo"
        // ("a" prefix denotes Artifact), "u_3_2_reflection".
        const synthesized = synthesizeFromId(id);
        if (synthesized !== null) {
          paperCards.push(synthesized);
          continue;
        }
        throw new Error(
          `TokenEffect: unknown TokenScript$ "${id}" — not present in the predefined token database`,
        );
      }
    } else {
      const power = hasParam(sa, "TokenPower") ? evaluateParamRaw(sa, "TokenPower") : "0";
      const toughness = hasParam(sa, "TokenToughness") ? evaluateParamRaw(sa, "TokenToughness") : "0";
      const name = hasParam(sa, "TokenName") ? evaluateParamRaw(sa, "TokenName") : "Token";
      const typesRaw = hasParam(sa, "TokenTypes") ? evaluateParamRaw(sa, "TokenTypes") : "Creature";
      const colorsRaw = hasParam(sa, "TokenColors") ? evaluateParamRaw(sa, "TokenColors") : "";
      const keywordsRaw = hasParam(sa, "TokenKeywords") ? evaluateParamRaw(sa, "TokenKeywords") : "";
      paperCards = [
        synthesizeTokenPaperCard({
          name,
          power,
          toughness,
          typesRaw,
          colorsRaw,
          keywordsRaw,
        }),
      ];
    }

    // ---- Create the tokens. We capture the returned ids so post-create
    //      modifiers (Tapped$, Attacking$, WithCounters$, RememberTokens$)
    //      can be applied. -----------------------------------------------
    const enterTapped = isTrue(hasParam(sa, "Tapped") ? evaluateParamRaw(sa, "Tapped") : undefined);
    const enterAttacking = isTrue(hasParam(sa, "Attacking") ? evaluateParamRaw(sa, "Attacking") : undefined);
    const withCounters = hasParam(sa, "WithCounters")
      ? parseWithCounters(evaluateParamRaw(sa, "WithCounters"))
      : null;
    const rememberTokens = isTrue(
      hasParam(sa, "RememberTokens") ? evaluateParamRaw(sa, "RememberTokens") : undefined,
    );

    const ids: (typeof sa.targets)[number][] = [];
    for (const paperCard of paperCards) {
      const created = yield* game.action.createToken({
        paperCard,
        controller: sa.controllerSeat,
        count,
      });
      ids.push(...created);
    }

    if (ids.length === 0) return;

    // Apply post-create modifiers.
    for (const id of ids) {
      const tok = game.cards.get(id);
      if (tok === undefined) continue;
      if (enterTapped) tok.tapped = true;
      if (enterAttacking) tok.enteredAttacking = true;
      if (withCounters !== null) {
        yield* game.action.addCounter(id, withCounters.ct, withCounters.n, sa.sourceCardId);
      }
    }

    if (rememberTokens) {
      const src = game.cards.get(sa.sourceCardId);
      if (src) {
        for (const id of ids) {
          if (!src.remembered.includes(id)) src.remembered.push(id);
        }
      }
    }
  }
}

effectRegistry.register(TokenEffect);

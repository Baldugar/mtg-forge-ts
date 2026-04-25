// SPDX-License-Identifier: GPL-3.0-or-later
// TokenEffect — creates tokens by synthesizing a PaperCard from inline DSL
// parameters (TokenName$, TokenPower$, TokenToughness$, TokenTypes$,
// TokenColors$, TokenKeywords$, TokenAmount$). The TokenScript$ form (which
// references a predefined token entry in the token database) is deferred to
// SP4 when the token database is wired in.
//
// Forge DSL (inline form):
//   A:SP$ Token | TokenAmount$ 1 | TokenPower$ 3 | TokenToughness$ 1
//     | TokenName$ Elemental | TokenTypes$ Creature,Elemental
//     | TokenColors$ Red | TokenKeywords$ Haste
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  TypeLine,
  keywordIdFromDisplayName,
} from "@mtg-forge-ts/core";
import type { CardDefinition, PaperCard, Supertype } from "@mtg-forge-ts/core";
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
// TokenEffect
// ---------------------------------------------------------------------------

export class TokenEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Token";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // TokenScript$ form requires the SP4 token database — defer with a clear error.
    if (hasParam(sa, "TokenScript")) {
      throw new Error("TokenEffect: TokenScript$ form deferred to SP4 — requires token database lookup");
    }

    const count = hasParam(sa, "TokenAmount") ? evaluateParamNumber(sa, "TokenAmount", game) : 1;
    const power = hasParam(sa, "TokenPower") ? evaluateParamRaw(sa, "TokenPower") : "0";
    const toughness = hasParam(sa, "TokenToughness") ? evaluateParamRaw(sa, "TokenToughness") : "0";
    const name = hasParam(sa, "TokenName") ? evaluateParamRaw(sa, "TokenName") : "Token";
    const typesRaw = hasParam(sa, "TokenTypes") ? evaluateParamRaw(sa, "TokenTypes") : "Creature";
    const colorsRaw = hasParam(sa, "TokenColors") ? evaluateParamRaw(sa, "TokenColors") : "";
    const keywordsRaw = hasParam(sa, "TokenKeywords") ? evaluateParamRaw(sa, "TokenKeywords") : "";

    const paperCard = synthesizeTokenPaperCard({
      name,
      power,
      toughness,
      typesRaw,
      colorsRaw,
      keywordsRaw,
    });

    yield* game.action.createToken({
      paperCard,
      controller: sa.controllerSeat,
      count,
    });
  }
}

effectRegistry.register(TokenEffect);

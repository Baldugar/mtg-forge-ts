// SPDX-License-Identifier: GPL-3.0-or-later
// MakeCardEffect — Forge `DB$ MakeCard` (Conjure / "create a card out of
// nothing"). Used by Wishes, Mind's Desire, and conjure-style cards
// (Sublime Epiphany's "conjure a duplicate"). Synthesizes a placeholder
// PaperCard with the named identity and puts it into the requested zone.
//
// Forge DSL examples:
//   SVar:GiftAbility:DB$ MakeCard | Name$ Rhystic Study | Defined$ Promised | Zone$ Battlefield
//   SVar:TrigConjure:DB$ MakeCard | Conjure$ True | DefinedName$ TriggeredCard | Zone$ Hand
//
// MVP scope:
//   - Name$ <CardName> | DefinedName$ <token> — accepted as the synthetic
//     card's identity.
//   - Zone$ <ZoneType> — destination (Hand/Battlefield/Library/Graveyard/
//     Exile). Defaults to Hand.
//   - Defined$ Promised → controller; Defined$ Targeted → target's owner;
//     else controller.
//   - RememberMade$ True appends the new EntityId to source.remembered.
//
// Wave 45 — when a runtime PaperCard registry is wired (via
// `registerMakeCardPaperCard`), MakeCard now consults the registry first
// and falls back to the synthetic placeholder on a miss. The registry is
// a process-local Map populated either by tests or by a future cards-
// package integration step.
//
// Wave 90 — additional fallback layer. Before placeholder synthesis we
// also scan the cards-package `tokenDatabase` by entry.name. Cards
// resolving to a printed token (Treasure, Food, Clue, Blood, Soldier,
// etc.) get the canonical TypeLine + abilities + colors from the
// database rather than the empty-Sorcery placeholder, so MakeCard can
// produce semi-functional named-token results without a registered
// PaperCard fixture.
//
// Resolution order (post-Wave 90):
//   1. PAPER_CARD_REGISTRY — explicit fixture wins (Wave 45).
//   2. tokenDatabase by name — canonical token data when the request
//      names a known token.
//   3. synthesizeMakeCardPaper — empty Sorcery placeholder (Wave 25).

/**
 * Process-local PaperCard lookup, populated by integration tests or a
 * future cards-package init hook. Keyed by `paperCard.name`.
 *
 * Registering the same name twice overwrites — last-wins. That matches
 * Forge's CardDb semantics (the latest printing in the inventory wins).
 */
const PAPER_CARD_REGISTRY = new Map<string, PaperCard>();

/**
 * Register a real PaperCard for MakeCard lookup. Called by tests +
 * (future) cards-package init.
 */
export const registerMakeCardPaperCard = (paperCard: PaperCard): void => {
  if (typeof paperCard.name !== "string" || paperCard.name.length === 0) {
    return;
  }
  PAPER_CARD_REGISTRY.set(paperCard.name, paperCard);
};

/**
 * Test/snapshot reset hook. Clears the registry. Engine tests that
 * register fixtures should call this in `afterEach`.
 */
export const clearMakeCardPaperCardRegistry = (): void => {
  PAPER_CARD_REGISTRY.clear();
};

export const lookupMakeCardPaperCard = (name: string): PaperCard | undefined => PAPER_CARD_REGISTRY.get(name);
import { tokenDatabase } from "@mtg-forge-ts/cards";
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  TypeLine,
  ZoneType,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { CardDefinition, EntityId, PaperCard, PlayerSeat, Supertype } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * Wave 90 — token-database lookup by printed name. Returns a synthesized
 * PaperCard from the matching `tokenDatabase` entry when the requested
 * name (case-insensitive) maps to a known token; otherwise undefined.
 */
const lookupTokenByName = (name: string): PaperCard | undefined => {
  const target = name.trim().toLowerCase();
  if (target.length === 0) return undefined;
  for (const entry of tokenDatabase.values()) {
    if (entry.name.trim().toLowerCase() === target) {
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
    }
  }
  return undefined;
};

const ZONE_BY_NAME: Record<string, ZoneType> = {
  hand: ZoneType.Hand,
  battlefield: ZoneType.Battlefield,
  graveyard: ZoneType.Graveyard,
  exile: ZoneType.Exile,
  library: ZoneType.Library,
};

const synthesizeMakeCardPaper = (name: string): PaperCard => {
  const definition: CardDefinition = {
    name,
    oracle: "",
    types: new TypeLine([] as Supertype[], [CardType.Sorcery], []),
    manaCost: null,
    colors: ColorSet.empty(),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name,
    edition: "MAK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

export class MakeCardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MakeCard";

  // biome-ignore lint/correctness/useYield: synchronous card synthesis (no events emitted in MVP)
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const name = hasParam(sa, "Name")
      ? evaluateParamRaw(sa, "Name")
      : hasParam(sa, "DefinedName")
        ? evaluateParamRaw(sa, "DefinedName")
        : "Unknown";
    const zoneRaw = hasParam(sa, "Zone") ? evaluateParamRaw(sa, "Zone").toLowerCase().trim() : "hand";
    const zone = ZONE_BY_NAME[zoneRaw] ?? ZoneType.Hand;

    let owner: PlayerSeat = sa.controllerSeat;
    if (hasParam(sa, "Defined")) {
      const def = evaluateParamRaw(sa, "Defined").trim();
      if (def === "Player.Opponent" || def === "Opponent") {
        const n = sa.controllerSeat as unknown as number;
        owner = mkPlayerSeat(n === 0 ? 1 : 0);
      }
    }

    const newId: EntityId = game.newEntityId();
    // Wave 45 — prefer the registered PaperCard when available so triggered/
    // activated abilities, P/T, and types come through. Fall back to the
    // placeholder when no fixture is registered.
    // Wave 90 — when the registry misses, also try the cards-package
    // tokenDatabase by name; only fall through to the empty placeholder
    // when neither lookup yields a match.
    const registered = lookupMakeCardPaperCard(name);
    const tokenMatch = registered ?? lookupTokenByName(name);
    const paper = tokenMatch ?? synthesizeMakeCardPaper(name);
    const newCard = new Card(newId, paper, owner, owner, zone);
    game.cards.set(newId, newCard);
    const player = game.getPlayer(owner);
    const z = player.zones.get(zone);
    if (z) z.add(newId);

    if (hasParam(sa, "RememberMade") && evaluateParamRaw(sa, "RememberMade") === "True") {
      const source = game.cards.get(sa.sourceCardId);
      if (source) source.remembered.push(newId);
    }
  }
}

effectRegistry.register(MakeCardEffect);

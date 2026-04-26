// SPDX-License-Identifier: GPL-3.0-or-later
// Foretell — alternative casting cost from exile, after the foretell special
// action exiled the card face-down.
//
// CR 702.143: "Foretell [cost] — During your turn, you may pay {2} and exile
// this card from your hand face down. Cast it on a later turn for its
// foretell cost."
//
// DSL form in card definitions:
//   K:Foretell:1 U      → foretell cost is {1}{U}
//   K:Foretell:R        → foretell cost is {R}
//   K:Foretell:0        → foretell cost is {0}
//
// Scope of THIS handler: the alt-cost arm only — i.e. given a card already in
// Exile (post-foretell-action), let the owner cast it paying the foretell
// cost. The foretell special action (Hand → Exile face-down for {2} during
// owner's turn at sorcery speed) is a separate mechanism not yet wired here.
// Once that lands, Foretell becomes invokable on a later turn without test
// scaffolding.
//
// isAvailable:
//   - Card must be in the Exile zone.
//   - Card must carry a "foretell" keyword with a cost parameter.
//
// modifyCastContext:
//   - Replaces ctx.totalCost.base with the foretell mana cost string.
//   - Sets ctx.altCostUsed = "Foretell".
//   - For non-permanent spells (Instant/Sorcery) we override
//     ctx.alternativeZoneDestination = Graveyard so the spell card moves
//     to its owner's graveyard after resolution (Madness/Flashback pattern
//     when casting from Exile). The cast-pipeline's stepChooseZoneOverride
//     defaults Exile-origin casts to Exile-destination (the cascade /
//     impulse pattern); Foretell instead routes the resolving spell to the
//     graveyard.
//   - For permanent spells (Creature, Artifact, Enchantment, Planeswalker,
//     Battle) the resolveStackItem pipeline will route the card to the
//     battlefield via the resolver's permanent-resolution path; the
//     alternativeZoneDestination is consulted only when no resolver took
//     ownership of the move. Setting Graveyard as a fallback is safe for
//     non-permanents and harmless for permanents (the battlefield path
//     short-circuits the fallback).
import type { CardDefinition, KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { CARD_TYPE_IS_PERMANENT, type CardType, ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractForetellCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "foretell");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

/**
 * True iff the card's definition declares at least one permanent type
 * (Creature, Artifact, Enchantment, Land, Planeswalker, Battle). Used to
 * decide whether the post-resolution destination should be Graveyard
 * (non-permanent spell — CR 608.2g) or left for the resolver to route to
 * Battlefield (permanent spell — CR 608.3a).
 */
const definitionIsPermanent = (def: CardDefinition): boolean => {
  for (const t of def.types.types) {
    if (CARD_TYPE_IS_PERMANENT[t as CardType]) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Foretell AltCost
// ---------------------------------------------------------------------------

export const Foretell: AltCost = {
  handlerKey: "Foretell",

  isAvailable(card: Card, _game: Game): boolean {
    // Must be in exile (post-foretell-action redirect).
    if (card.zone !== ZoneType.Exile) return false;
    // Must have a foretell keyword with a cost.
    return extractForetellCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractForetellCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Foretell";

    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: cost },
    };

    // stepChooseZoneOverride pre-set alternativeZoneDestination = Exile for
    // any Exile-origin cast (cascade / impulse pattern). Foretell instead
    // routes the resolving card:
    //   - non-permanent spells → owner's graveyard (CR 608.2g),
    //   - permanent spells → battlefield (CR 608.3a).
    // resolveStackItem reads provenance.alternativeZoneDestination as the
    // post-resolution destination for the source card; we set it explicitly
    // here so both paths route correctly without relying on a separate
    // permanent-entry pipeline.
    const def = card.paperCard.definition;
    const dest = def && definitionIsPermanent(def) ? ZoneType.Battlefield : ZoneType.Graveyard;
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = dest;
  },
};

altCostRegistry.register(Foretell);

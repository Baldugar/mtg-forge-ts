// SPDX-License-Identifier: GPL-3.0-or-later
// Plot — alternative casting cost from exile, after the plot special action
// (Hand → Exile face-up) has stamped `card.plotted = true` and
// `card.plottedOnTurn = <turn>`.
//
// CR 718 (Bloomburrow): "Plot [cost] — During your main phase any time you
// could cast a sorcery, you may pay [cost] and exile this card from your
// hand face up. You may cast it as a sorcery on a LATER turn without
// paying its mana cost."
//
// DSL form in card definitions:
//   K:Plot:1 R     → plot cost is {1}{R} (charged at plot-time, not cast-time)
//   K:Plot:U       → plot cost is {U}
//   K:Plot:0       → plot cost is {0}
//
// Scope of THIS handler: the alt-cost arm only — i.e. given a card already in
// Exile with plotted=true and plottedOnTurn !== game.turn, let the controller
// cast it for FREE (no mana paid). The plot special action (Hand → Exile +
// stamp + emit CardPlotted) is performed by the synthesized hand-zone
// activated ability in keyword/handlers/plot-keyword.ts via the PlotEffect.
//
// Compare to Foretell (CR 702.143) — Foretell exiles face-DOWN and the cast
// pays the foretell mana cost. Plot exiles face-UP and the cast is FREE.
//
// isAvailable:
//   - Card must be in the Exile zone.
//   - card.plotted === true.
//   - card.plottedOnTurn !== game.turn (must be a different turn).
//
// modifyCastContext:
//   - Sets ctx.totalCost.base.raw = "" — the cast pays no mana.
//   - Sets ctx.altCostUsed = "Plot".
//   - Routes the post-resolution destination:
//       - permanent spells (Creature/Artifact/Enchantment/Planeswalker/
//         Battle) → Battlefield (CR 608.3a, like Foretell);
//       - non-permanent spells (Instant/Sorcery) → Graveyard (CR 608.2g,
//         the Madness/Flashback pattern when casting from Exile).
//     Without this override stepChooseZoneOverride defaults Exile-origin
//     casts to Exile-destination (the cascade pattern), which is wrong
//     for both Plot branches.
import type { CardDefinition, KeywordAst } from "@mtg-forge-ts/core";
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

/**
 * True iff the card carries a "plot" keyword in its definition. Plot can
 * only be invoked on cards declared with K:Plot:<cost>; tokens / cards
 * without a definition fail this check.
 */
const hasPlotKeyword = (card: Card): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return false;
  return keywords.some((k) => k.keyword === "plot");
};

/**
 * Mirror of foretell.ts/definitionIsPermanent — true iff the card's
 * definition declares at least one permanent type. Used to decide whether
 * the post-resolution destination should be Battlefield (permanent spell)
 * or Graveyard (non-permanent spell).
 */
const definitionIsPermanent = (def: CardDefinition): boolean => {
  for (const t of def.types.types) {
    if (CARD_TYPE_IS_PERMANENT[t as CardType]) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Plot AltCost
// ---------------------------------------------------------------------------

export const Plot: AltCost = {
  handlerKey: "Plot",

  isAvailable(card: Card, game: Game): boolean {
    // Must be in exile (post-plot-action redirect).
    if (card.zone !== ZoneType.Exile) return false;
    // Must currently be plotted (the plot special-action stamped the flag).
    if (card.plotted !== true) return false;
    // CR 718.1c — "on a LATER turn". Reject if same turn the card was plotted.
    if (card.plottedOnTurn === undefined || card.plottedOnTurn === game.turn) return false;
    // Must declare the plot keyword (defensive — guards against stale flags
    // on cards that never had plot to begin with).
    return hasPlotKeyword(card);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Plot";

    // Free cast — empty mana cost string. parseCostString("") yields a plan
    // with no mana segments; payCost is a no-op (no mana drained from the
    // pool).
    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: "" },
    };

    // Route post-resolution destination — see header comment for the full
    // permanent vs. non-permanent split.
    const def = card.paperCard.definition;
    const dest = def && definitionIsPermanent(def) ? ZoneType.Battlefield : ZoneType.Graveyard;
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = dest;
  },
};

altCostRegistry.register(Plot);

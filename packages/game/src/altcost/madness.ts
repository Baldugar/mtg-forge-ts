// SPDX-License-Identifier: GPL-3.0-or-later
// Madness — alternative casting cost from exile after a discard.
//
// CR 702.34: "Madness [cost] — If a player discards this card, the player
// discards it into exile. When you do, cast it for its madness cost or put
// it into your graveyard."
//
// DSL form in card definitions:
//   K:Madness:R       → madness cost is {R}
//   K:Madness:1 R     → madness cost is {1}{R}
//   K:Madness:0       → madness cost is {0}
//
// Scope of THIS handler: the alt-cost arm only — i.e. given a card already in
// Exile (post-discard), let the owner cast it paying the madness cost. The
// discard-time zone redirect (Hand→Exile instead of Hand→Graveyard) and the
// wrapping discarded-trigger that opens the cast window are SEPARATE
// mechanisms not yet wired here. Once they land, Madness will be invokable
// during the trigger window without test scaffolding.
//
// isAvailable:
//   - Card must be in the Exile zone.
//   - Card must carry a "madness" keyword with a cost parameter.
//
// modifyCastContext:
//   - Replaces ctx.totalCost.base with the madness mana cost string.
//   - Sets ctx.altCostUsed = "Madness".
//   - Overrides ctx.alternativeZoneDestination back to Graveyard. Without
//     this override, stepChooseZoneOverride defaults Exile-origin casts to
//     Exile-destination (the cascade/foretell pattern). Madness sends the
//     card to its owner's graveyard after resolution (CR 608.2g — non-
//     permanent spell goes to graveyard on resolution).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

// ---------------------------------------------------------------------------
// Helper: extract madness cost string from keyword AST.
// ---------------------------------------------------------------------------

const extractMadnessCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "madness");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

// ---------------------------------------------------------------------------
// Madness AltCost
// ---------------------------------------------------------------------------

export const Madness: AltCost = {
  handlerKey: "Madness",

  isAvailable(card: Card, _game: Game): boolean {
    // Must be in exile (post-discard redirect).
    if (card.zone !== ZoneType.Exile) return false;
    // Must have a madness keyword with a cost.
    return extractMadnessCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractMadnessCost(card);
    if (cost === null) return;

    // Mark this cast as paying the Madness alt cost. stepDetermineTotalCost
    // honours altCostUsed by leaving the pre-seeded totalCost.base in place
    // instead of overwriting it with the card's normal mana cost.
    (ctx as { altCostUsed: string | null }).altCostUsed = "Madness";

    // Pre-seed the cost: stepPayCosts reads totalCost.base.raw as the mana
    // cost string. The format ("R", "1 R", etc.) matches the regular mana
    // cost grammar parsed by parseCostString.
    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: cost },
    };

    // Override the Exile-origin default (Exile→Exile) back to graveyard.
    // stepChooseZoneOverride pre-set alternativeZoneDestination = Exile for
    // any Exile-origin cast (cascade / foretell pattern). Madness instead
    // sends the spell card to its owner's graveyard after resolution; the
    // override is required so resolveStackItem routes correctly.
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination =
      ZoneType.Graveyard;
  },
};

altCostRegistry.register(Madness);

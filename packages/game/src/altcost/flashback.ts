// SPDX-License-Identifier: GPL-3.0-or-later
// Flashback — alternative casting cost from the graveyard.
//
// CR 702.34: "Flashback [cost] — You may cast this card from your graveyard
// for its flashback cost. Then exile it."
//
// DSL form in card definitions:
//   K:Flashback:R         → flashback cost is {R}
//   K:Flashback:2U        → flashback cost is {2}{U}
//   K:Flashback:0         → flashback cost is {0}
//
// isAvailable:
//   - Card must be in the Graveyard zone.
//   - Card must carry a "flashback" keyword with a cost parameter.
//
// modifyCastContext:
//   - Replaces ctx.totalCost.base with the flashback mana cost string.
//   - Sets ctx.altCostUsed = "Flashback".
//   - Sets ctx.alternativeZoneDestination = ZoneType.Exile so the resolver
//     moves the card to exile instead of the graveyard after resolution.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

// ---------------------------------------------------------------------------
// Helper: extract flashback cost string from keyword AST.
// ---------------------------------------------------------------------------

const extractFlashbackCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "flashback");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

// ---------------------------------------------------------------------------
// Flashback AltCost
// ---------------------------------------------------------------------------

export const Flashback: AltCost = {
  handlerKey: "Flashback",

  isAvailable(card: Card, _game: Game): boolean {
    // Must be in graveyard.
    if (card.zone !== ZoneType.Graveyard) return false;
    // Must have a flashback keyword with a cost.
    return extractFlashbackCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractFlashbackCost(card);
    if (cost === null) return;

    // Replace the mana cost base with the flashback cost string.
    // ctx.totalCost is set by stepDetermineTotalCost (step 8); at the time
    // stepChooseAltCosts (step 4) runs, totalCost may not be set yet.
    // We store the flashback cost in altCostOverride on a duck-typed cast so
    // stepDetermineTotalCost can pick it up, OR we patch totalCost directly
    // if it is already set.
    //
    // Wave 5 MVP: patch totalCost.base directly. stepDetermineTotalCost runs
    // AFTER stepChooseAltCosts, so totalCost is undefined here. We use a
    // mutable cast to write a pre-seed object; stepDetermineTotalCost
    // overwrites it unless it honours altCostUsed.
    //
    // The flag altCostUsed = "Flashback" tells the cost-payment step to use
    // flashbackCostRaw instead of the card's normal mana cost.
    (ctx as { altCostUsed: string | null }).altCostUsed = "Flashback";

    // Store the raw flashback cost on a well-known extensible field so the
    // mana-payment step (Wave 5 manual test + future SP3 cost solver) can
    // read it back. We hang it off totalCost as { base: { raw } }.
    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: cost },
    };

    // After resolution the card goes to exile, not the graveyard.
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = ZoneType.Exile;
  },
};

altCostRegistry.register(Flashback);

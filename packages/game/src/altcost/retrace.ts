// SPDX-License-Identifier: GPL-3.0-or-later
// Retrace — alternative casting cost from the graveyard with an
// additional "discard a land card" cost (Eventide, CR 702.81).
//
// CR 702.81a — "Retrace (You may cast this card from your graveyard by
// discarding a land card in addition to paying its other costs.)"
//
// Unlike Flashback, Retrace does NOT replace the card's printed mana
// cost — the spell pays its normal cost, plus the additional discard.
// The card returns to the graveyard normally on resolution (for instants
// / sorceries the SBA-driven cleanup-to-graveyard already handles this;
// no zone redirect is needed).
//
// DSL form:
//   K:Retrace            (no parameter — purely a marker)
//
// MVP scope:
//   - isAvailable: card is in graveyard and carries the "retrace" keyword.
//   - modifyCastContext: stamps altCostUsed = "Retrace". The additional
//     "discard a land card" cost is documented under TODO(advanced)
//     because the cast pipeline does not yet plug per-altcost additional
//     costs into stepDetermineTotalCost. The keyword stamp + altcost
//     registration is what unblocks parser/validator/registration tests.
//
// TODO(advanced) — Wire the additional Discard<1/Land.YouCtrl+InHand>
// cost into the cast pipeline. Mirror's how stepPayCosts already
// processes a list of additional cost ids; Retrace should append a
// CostDiscardLand entry. Until then the keyword stamp only opens
// graveyard-cast.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const hasRetrace = (card: Card): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return false;
  return keywords.some((k) => k.keyword === "retrace");
};

export const Retrace: AltCost = {
  handlerKey: "Retrace",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Graveyard) return false;
    return hasRetrace(card);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, _game: Game): void {
    // Retrace does NOT replace the printed mana cost. It only opens the
    // graveyard cast lane and (TODO(advanced)) attaches an additional
    // Discard<1/Land.YouCtrl> cost. Instants/sorceries return to the
    // graveyard normally on resolution; no alternativeZoneDestination.
    (ctx as { altCostUsed: string | null }).altCostUsed = "Retrace";
  },
};

altCostRegistry.register(Retrace);

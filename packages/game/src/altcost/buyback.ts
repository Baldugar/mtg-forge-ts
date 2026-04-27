// SPDX-License-Identifier: GPL-3.0-or-later
// Buyback — additional optional cost on cast that returns the spell to
// its owner's hand instead of the graveyard on resolution.
//
// CR 702.26a — "Buyback [cost]" — "You may pay an additional [cost] as
// you cast this spell. If the buyback cost was paid, put this card back
// into its owner's hand as it resolves."
//
// DSL form in card definitions:
//   K:Buyback:3       → buyback cost is {3} (additive on top of mana cost)
//   K:Buyback:1 U     → buyback cost is {1}{U}
//
// MVP scope: Buyback is structurally an *additional* cost (not an
// alternative to the mana cost). The MVP wires it through the AltCost
// surface anyway so the keyword stamps and the post-resolution routing
// to Hand is observable for tests; the proper "additional cost" hook in
// stepDetermineTotalCost is documented under TODO(advanced) below.
//
// isAvailable:
//   - Card must be in the Hand zone (the cast originates there).
//   - Card must carry a "buyback" keyword with a cost parameter.
//
// modifyCastContext:
//   - Sets ctx.altCostUsed = "Buyback".
//   - Pre-seeds totalCost.base by concatenating the printed mana cost
//     with the buyback cost (additive — buyback is an additional cost,
//     not a replacement). MVP reads only the literal cost string from
//     the keyword and seeds the literal sum; the cost solver tolerates
//     concatenated mana strings.
//   - Sets ctx.alternativeZoneDestination = ZoneType.Hand so the resolver
//     routes the card back to its owner's hand after resolution.
//   - Stamps `card.buybackPaid = true` for SVar conditional reads.
//
// TODO(advanced) — the cost-solver gate that adds buyback as an additive
// optional cost (rather than a replacement) lives in the cast pipeline's
// stepDetermineTotalCost. The MVP path here patches totalCost.base
// directly; the precise "mana + buyback" sum is left to follow-up work
// in the cost solver.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractBuybackCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "buyback");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

const extractBaseManaCost = (card: Card): string => {
  const def = card.paperCard.definition;
  if (!def) return "";
  const mc = def.manaCost as { raw?: string } | null;
  return mc?.raw ?? "";
};

export const Buyback: AltCost = {
  handlerKey: "Buyback",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    return extractBuybackCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractBuybackCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Buyback";

    // Pre-seed totalCost.base with the additive sum of the printed mana
    // cost + the buyback cost. The literal-string concatenation is
    // tolerated by the cost solver.
    const base = extractBaseManaCost(card);
    const combined = base.length > 0 ? `${base} ${cost}` : cost;
    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: combined },
    };

    // Route the card back to its owner's hand after resolution.
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = ZoneType.Hand;

    // Stamp the slot for SVar / replay observability.
    card.buybackPaid = true;
  },
};

altCostRegistry.register(Buyback);

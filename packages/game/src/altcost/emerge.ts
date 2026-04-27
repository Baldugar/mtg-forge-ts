// SPDX-License-Identifier: GPL-3.0-or-later
// Emerge — alternative casting cost from the hand that sacrifices a
// creature as an additional cost; the cost is reduced by the sacrificed
// creature's mana value (Eldritch Moon, CR 702.118).
//
// CR 702.118a — "Emerge [cost]" — "You may cast this spell by paying its
// emerge cost reduced by the mana value of a creature you sacrifice."
//
// DSL form in card definitions:
//   K:Emerge:5 G       → emerge cost is {5}{G}
//
// MVP scope:
//   - isAvailable: card in Hand with K:Emerge AND controller has any
//     creature on battlefield to sacrifice.
//   - modifyCastContext: stamp altCostUsed = "Emerge", replace
//     totalCost.base with the emerge cost (the cost-reduction by
//     sacrificed creature's mana value is TODO(advanced) — requires the
//     sacrifice-target choice to be threaded through the cost solver).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractEmergeCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "emerge");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

const hasSacrificeableCreature = (card: Card, game: Game): boolean => {
  for (const [id, c] of game.cards) {
    if (c.zone !== ZoneType.Battlefield) continue;
    if (c.controllerSeat !== card.controllerSeat) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (chars.types.has(CardType.Creature)) return true;
  }
  return false;
};

export const Emerge: AltCost = {
  handlerKey: "Emerge",

  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractEmergeCost(card) === null) return false;
    return hasSacrificeableCreature(card, game);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractEmergeCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Emerge";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    card.emergeCast = true;
  },
};

altCostRegistry.register(Emerge);

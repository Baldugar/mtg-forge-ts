// SPDX-License-Identifier: GPL-3.0-or-later
// Miracle — alternative casting cost from the hand, available only if
// this card was the first card drawn this turn (Avacyn Restored, CR
// 702.94).
//
// CR 702.94a — "Miracle [cost]" — "You may cast this card for its
// miracle cost when you draw it if it's the first card you've drawn
// this turn."
//
// DSL form in card definitions:
//   K:Miracle:R       → miracle cost is {R}
//
// MVP scope:
//   - isAvailable: card in Hand with K:Miracle AND
//     `card.miracleEligible === true` — a flag stamped by the draw
//     pipeline when this is the first card drawn this turn (the slot
//     read here; the stamp wiring lives in the draw replacement).
//   - modifyCastContext: stamp altCostUsed = "Miracle", replace
//     totalCost.base.
//
// The "must be cast as you draw it" timing window is enforced by the
// miracleEligible slot itself: the draw pipeline stamps it and clears
// it after the priority pass.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractMiracleCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "miracle");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export const Miracle: AltCost = {
  handlerKey: "Miracle",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractMiracleCost(card) === null) return false;
    return card.miracleEligible === true;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractMiracleCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Miracle";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    card.miracleCast = true;
  },
};

altCostRegistry.register(Miracle);

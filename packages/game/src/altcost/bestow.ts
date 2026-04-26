// SPDX-License-Identifier: GPL-3.0-or-later
// Bestow — alternative casting cost from hand. The spell becomes an Aura
// spell with "enchant creature" while paying the bestow cost; it resolves
// attached to the chosen creature. While attached, it is an Aura (NOT a
// creature). When it becomes unattached, it stops being an Aura and reverts
// to being a creature on the battlefield (CR 702.103).
//
// CR 702.103: "Bestow [cost] — You may cast this card for its bestow cost.
// If you do, it's an Aura spell with enchant creature. It becomes a
// creature again if it's not attached to a creature."
//
// DSL form in card definitions:
//   K:Bestow:3 G G    → bestow cost is {3}{G}{G}
//
// isAvailable:
//   - Card must be in the Hand zone.
//   - Card must carry a "bestow" keyword with a cost parameter.
//
// modifyCastContext:
//   - Replaces ctx.totalCost.base with the bestow mana cost string.
//   - Sets ctx.altCostUsed = "Bestow".
//   - Sets ctx.bestowed = true. The cast pipeline reads this to:
//       1. Synthesize a creature-target restriction in stepChooseTargets so
//          the caster picks one creature to enchant.
//       2. Tag the bound SpellAbility with `tags: Set(["bestowed"])` so the
//          spell's resolve path attaches the source card to the chosen
//          target instead of merely sending it to a destination zone.
//   - No alternativeZoneDestination — Bestow's resolution path is the
//     attach-on-battlefield route, handled by the bestow-aware resolveStackItem.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractBestowCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "bestow");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export const Bestow: AltCost = {
  handlerKey: "Bestow",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    return extractBestowCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractBestowCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Bestow";

    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: cost },
    };

    // Bestow stays on the battlefield (attached). No alternative-zone
    // destination — the resolveStackItem path consults ctx.bestowed to
    // perform the attach-on-resolution flow.
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination =
      ZoneType.Battlefield;

    // Mark the cast as bestowed so stepChooseTargets enumerates creatures
    // and finalizeStackItem stamps the bound SpellAbility's tags so the
    // resolver knows to attach.
    (ctx as { bestowed: boolean }).bestowed = true;
  },
};

altCostRegistry.register(Bestow);

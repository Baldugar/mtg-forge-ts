// SPDX-License-Identifier: GPL-3.0-or-later
// Overload — alternative casting cost from hand. The spell becomes targetless
// and applies to EACH matching object instead of one chosen target.
//
// CR 702.96: "Overload [cost] — You may cast this spell for its overload
// cost. If you do, change its text by replacing all instances of 'target'
// with 'each.' That player or those players still must choose objects to
// be the spell's targets, but the spell does not target them."
// (Operationally: an overloaded spell is targetless and enumerates ALL
// objects that match its ValidTgts$ filter.)
//
// DSL form in card definitions:
//   K:Overload:3 U     → overload cost is {3}{U}
//   K:Overload:R       → overload cost is {R}
//
// isAvailable:
//   - Card must be in the Hand zone (overload is a cast-from-hand cost).
//   - Card must carry an "overload" keyword with a cost parameter.
//
// modifyCastContext:
//   - Replaces ctx.totalCost.base with the overload mana cost string.
//   - Sets ctx.altCostUsed = "Overload".
//   - Sets ctx.overloaded = true. The cast pipeline reads this flag to:
//       1. Skip stepChooseTargets (the spell is targetless).
//       2. Tag the bound SpellAbility with `tags: Set(["overloaded"])` so
//          effect handlers (TapEffect, DestroyEffect, DealDamageEffect)
//          enumerate ALL ValidTgts$-matching objects at resolve time
//          instead of iterating sa.targets.
//   - No alternativeZoneDestination override — overload is cast from hand,
//     and the spell card's default post-resolution destination (graveyard
//     for non-permanent spells per CR 608.2g) is correct.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractOverloadCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "overload");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export const Overload: AltCost = {
  handlerKey: "Overload",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    return extractOverloadCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractOverloadCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Overload";

    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: cost },
    };

    // Mark the cast as overloaded so stepChooseTargets skips target
    // selection and finalizeStackItem tags the bound SpellAbility for
    // effect-handler-driven enumeration.
    (ctx as { overloaded: boolean }).overloaded = true;
  },
};

altCostRegistry.register(Overload);

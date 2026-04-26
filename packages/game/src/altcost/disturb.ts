// SPDX-License-Identifier: GPL-3.0-or-later
// Disturb — alternative casting cost from the graveyard, transformed.
//
// CR 702.156: "Disturb [cost] — You may cast this card from your
// graveyard transformed for its disturb cost." After the disturb-cast
// resolves, the back face enters the battlefield (CR 712 transform
// rules) instead of the front face. If it would leave the battlefield,
// it is exiled instead.
//
// DSL form in card definitions:
//   K:Disturb:1U          → disturb cost is {1}{U}
//   K:Disturb:0           → disturb cost is {0}
//
// MVP scope (mirrors Flashback structure):
//   - isAvailable: card in graveyard with a disturb keyword + cost.
//   - modifyCastContext:
//       - replaces totalCost.base with the disturb cost string,
//       - sets altCostUsed = "Disturb",
//       - stamps card.disturbed = true so the resolver / face logic
//         knows to land the back face on the battlefield. Forge's full
//         transform mechanic (face-flip on resolve) is wired
//         progressively; the data-layer flag is the durable contract.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractDisturbCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "disturb");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export const Disturb: AltCost = {
  handlerKey: "Disturb",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Graveyard) return false;
    return extractDisturbCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractDisturbCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Disturb";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    // Mark the card so the resolver (and any face-derivation downstream)
    // knows this resolution is the back face. The flag is durable until
    // the card next leaves the battlefield, mirroring Forge's
    // "transformed" transient.
    card.disturbed = true;
  },
};

altCostRegistry.register(Disturb);

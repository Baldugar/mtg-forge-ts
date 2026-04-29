// SPDX-License-Identifier: GPL-3.0-or-later
// Warp — alternative casting cost from the hand that exiles the spell
// after resolution; the exiled card may then be cast as a creature for
// a later cost (Edge of Eternities, CR 702.180).
//
// CR 702.180a — "Warp [cost]" — "You may cast this card from your hand
// for its warp cost. If you do, exile it as it resolves. As long as
// the exiled card is in exile, you may cast the warped form."
//
// DSL form in card definitions:
//   K:Warp:2 R       → warp cost is {2}{R}
//
// MVP scope:
//   - isAvailable: card in Hand with K:Warp.
//   - modifyCastContext: stamp altCostUsed = "Warp", replace
//     totalCost.base, route to Exile post-resolution. The cast-as-
//     creature follow-up from exile is documented under TODO(advanced).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractWarpCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "warp");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export const Warp: AltCost = {
  handlerKey: "Warp",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    return extractWarpCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractWarpCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Warp";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = ZoneType.Exile;
    card.warpCast = true;
    // Wave 65.B — stamp the EOT-exile marker so the PhaseHandler's
    // EndStep sweep exiles this card at the next end step (CR 702.180a:
    // "If you cast it this way, exile it at the beginning of the next
    // end step"). Cleared by the sweep so the flag is one-shot.
    card.warpedUntilEot = true;
  },
};

altCostRegistry.register(Warp);

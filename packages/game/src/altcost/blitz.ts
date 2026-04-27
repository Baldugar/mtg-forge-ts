// SPDX-License-Identifier: GPL-3.0-or-later
// Blitz — alternative casting cost from the hand that grants the source
// haste, draws a card on death, and sacrifices at end of turn (Streets
// of New Capenna, CR 702.151).
//
// CR 702.151a — "Blitz [cost]" — "You may cast this card from your hand
// for its blitz cost. If you do, it gains haste and 'When this creature
// dies, draw a card.' Sacrifice it at the beginning of the next end
// step."
//
// DSL form in card definitions:
//   K:Blitz:1 R       → blitz cost is {1}{R}
//
// MVP scope:
//   - isAvailable: card in Hand with K:Blitz.
//   - modifyCastContext: stamp altCostUsed = "Blitz", replace
//     totalCost.base, set `card.blitzCast = true`. The granted haste +
//     when-dies-draw + EoT-sac wiring is documented under TODO(advanced)
//     — read by Wave 51 Count$Blitz selectors.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractBlitzCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "blitz");
  if (!kw) return null;
  // Wave 59 — keyword-line parser cleanup moved blitz into COST_KEYWORDS,
  // so the canonical slot is `cost`. The legacy `detail` fallback is
  // retained for snapshot-restore tolerance only.
  const costParam =
    (kw.params?.cost as ParamValue | undefined) ?? (kw.params?.detail as ParamValue | undefined);
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export const Blitz: AltCost = {
  handlerKey: "Blitz",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    return extractBlitzCost(card) !== null;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractBlitzCost(card);
    if (cost === null) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Blitz";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    card.blitzCast = true;
  },
};

altCostRegistry.register(Blitz);

// SPDX-License-Identifier: GPL-3.0-or-later
// Unearth — alternative casting cost from the graveyard granting haste
// until end of turn, then exiling at the beginning of the next end step
// (Future Sight, CR 702.83). Registered as both a KeywordHandler (so the
// keyword stamp is observable) and as an AltCost (so the cast pipeline's
// stepChooseAltCosts surface picks it up).
//
// CR 702.83a — "Unearth [cost]" — "[cost]: Return this card from your
// graveyard to the battlefield. It gains haste. Exile it at the beginning
// of the next end step or if it would leave the battlefield. Activate
// only as a sorcery."
//
// MVP scope:
//   1. Adds "unearth" to card.keywords.
//   2. Stamps `card.unearthCost` so SVar / replay observability picks it up.
//   3. Registers an AltCost (graveyard zone) that stamps `card.unearthCast
//      = true` and routes post-resolution → Battlefield. The granted haste
//      UEoT + EoT-exile delayed trigger are documented under TODO(advanced).
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../../ability/spell-ability.js";
import type { Card } from "../../card.js";
import type { CastContext } from "../../cast/cast-context.js";
import type { Game } from "../../game.js";
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import type { AltCost } from "../../registries/alt-cost-registry.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

const extractUnearthCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "unearth");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export class UnearthKeywordHandler extends KeywordHandler {
  static override readonly keyword = "unearth" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("unearth");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.unearthCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("unearth");
    card.unearthCost = undefined;
    card.unearthCast = undefined;
  }
}

export const Unearth: AltCost = {
  handlerKey: "Unearth",
  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Graveyard) return false;
    return extractUnearthCost(card) !== null;
  },
  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractUnearthCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Unearth";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination =
      ZoneType.Battlefield;
    card.unearthCast = true;
  },
};

altCostRegistry.register(Unearth);
keywordHandlerRegistry.register(UnearthKeywordHandler);

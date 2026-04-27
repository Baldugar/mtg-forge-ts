// SPDX-License-Identifier: GPL-3.0-or-later
// Spectacle — alternative casting cost from the hand if any opponent has
// lost life this turn (Ravnica Allegiance, CR 702.135). Registered as both
// a KeywordHandler (so the keyword stamp is observable) and as an AltCost.
//
// CR 702.135a — "Spectacle [cost]" — "You may cast this spell for its
// spectacle cost rather than its mana cost if an opponent lost life this
// turn."
//
// MVP scope:
//   1. Adds "spectacle" to card.keywords.
//   2. Stamps `card.spectacleCost`.
//   3. Registers an AltCost (hand zone, gated on
//      `game.flags.lifeLostThisTurn` for any opponent ≥ 1).
import type { KeywordAst, ParamValue, PlayerSeat } from "@mtg-forge-ts/core";
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

const extractSpectacleCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "spectacle");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

const opponentLostLifeThisTurn = (card: Card, game: Game): boolean => {
  const flags = game.flags as { lifeLostThisTurn?: ReadonlyMap<PlayerSeat, number> };
  if (!flags.lifeLostThisTurn) return false;
  const own = card.controllerSeat;
  for (const [seat, n] of flags.lifeLostThisTurn) {
    if (seat === own) continue;
    if (n > 0) return true;
  }
  return false;
};

export class SpectacleKeywordHandler extends KeywordHandler {
  static override readonly keyword = "spectacle" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("spectacle");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.spectacleCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("spectacle");
    card.spectacleCost = undefined;
  }
}

export const Spectacle: AltCost = {
  handlerKey: "Spectacle",
  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractSpectacleCost(card) === null) return false;
    return opponentLostLifeThisTurn(card, game);
  },
  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractSpectacleCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Spectacle";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
  },
};

altCostRegistry.register(Spectacle);
keywordHandlerRegistry.register(SpectacleKeywordHandler);

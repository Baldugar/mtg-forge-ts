// SPDX-License-Identifier: GPL-3.0-or-later
// Freerunning — alternative casting cost from the hand if a player was
// dealt combat damage by one of your creatures this turn (Outlaws of
// Thunder Junction, CR 702.179). Registered as both a KeywordHandler and
// as an AltCost.
//
// CR 702.179a — "Freerunning [cost]" — "You may cast this spell for its
// freerunning cost if an opponent was dealt combat damage by a Rogue,
// Assassin, Pirate, Mercenary, or Ninja you control this turn."
// Forge MVP simplifies the gate to "any combat damage to any player by
// your creatures this turn"; the printed-creature-type narrowing is
// documented under TODO(advanced).
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

const extractFreerunningCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "freerunning");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

const controllerDealtCombatDamage = (card: Card, game: Game): boolean => {
  const flags = game.flags as { combatDamageDealtThisTurn?: ReadonlyMap<PlayerSeat, number> };
  if (!flags.combatDamageDealtThisTurn) return false;
  return (flags.combatDamageDealtThisTurn.get(card.controllerSeat) ?? 0) > 0;
};

export class FreerunningKeywordHandler extends KeywordHandler {
  static override readonly keyword = "freerunning" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("freerunning");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.freerunningCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("freerunning");
    card.freerunningCost = undefined;
  }
}

export const Freerunning: AltCost = {
  handlerKey: "Freerunning",
  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractFreerunningCost(card) === null) return false;
    return controllerDealtCombatDamage(card, game);
  },
  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractFreerunningCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Freerunning";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
  },
};

altCostRegistry.register(Freerunning);
keywordHandlerRegistry.register(FreerunningKeywordHandler);

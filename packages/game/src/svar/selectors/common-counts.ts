// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 12D — common Count$<arg> forms found in the Forge corpus that the
// thin Count$ dispatcher previously rejected. Each registers itself into
// countArgRegistry; cards using these forms now compute correct values
// instead of silently throwing in the cost-mod / amount-resolver fallback.
//
// Forms registered here (all are PER-controller from the SvarContext):
//   - YourLifeTotal     : ctx.controller's life total (93 corpus cards)
//   - OppLifeTotal      : opponent's life total
//   - RememberedSize    : ctx.sourceCard.remembered.length (74 corpus cards)
//   - YourPoisonCounters: ctx.controller's poison counters
//
// The arg lookup is case-sensitive — Forge always emits PascalCase. Cards
// using forms not registered here still fall through to the original
// "throw" path; cost-mod helpers wrap that in a try/catch returning 0.
import type { PlayerSeat, SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "../context.js";
import { countArgRegistry } from "./count.js";

const yourLifeTotal = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  return ctx.game.getPlayer(ctx.controller).life;
};

const oppLifeTotal = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  // Two-player MVP — opponent is the OTHER seat.
  const opp = (1 - (ctx.controller as unknown as number)) as PlayerSeat;
  return ctx.game.getPlayer(opp).life;
};

const rememberedSize = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.sourceCardId === undefined) return 0;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  if (!card) return 0;
  return card.remembered.length;
};

const yourPoisonCounters = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  const player = ctx.game.getPlayer(ctx.controller);
  // Player.poisonCounters / poison may exist; probe defensively to avoid
  // hard-coupling against shape evolution.
  const probe = player as unknown as { poisonCounters?: number; poison?: number };
  return probe.poisonCounters ?? probe.poison ?? 0;
};

countArgRegistry.register("YourLifeTotal", yourLifeTotal);
countArgRegistry.register("OppLifeTotal", oppLifeTotal);
countArgRegistry.register("RememberedSize", rememberedSize);
countArgRegistry.register("RememberedNumber", rememberedSize); // alias used by some cards
countArgRegistry.register("YourPoisonCounters", yourPoisonCounters);

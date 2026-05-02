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
//   - NumCardsInGraveyard / NumCardsInYourGraveyard / NumCardsInOppGraveyard
//     : graveyard-size counts (Body Count Casualty, threshold cards)
//
// The arg lookup is case-sensitive — Forge always emits PascalCase. Cards
// using forms not registered here still fall through to the original
// "throw" path; cost-mod helpers wrap that in a try/catch returning 0.
import { ZoneType } from "@mtg-forge-ts/core";
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

// M6.16 — Graveyard size counts. Body Count's Casualty SVar uses
// Count$NumCardsInGraveyard (sum of both players' graveyards in Forge);
// some cards specialize to "your graveyard" or "opponent's graveyard".
const sumGraveyards = (ctx: SvarContext): number => {
  let n = 0;
  for (const card of ctx.game.cards.values()) {
    if (card.zone === ZoneType.Graveyard) n += 1;
  }
  return n;
};

const yourGraveyardSize = (ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  let n = 0;
  for (const card of ctx.game.cards.values()) {
    if (card.zone === ZoneType.Graveyard && card.controllerSeat === ctx.controller) n += 1;
  }
  return n;
};

const oppGraveyardSize = (ctx: SvarContext): number => {
  if (ctx.controller === undefined) return 0;
  let n = 0;
  for (const card of ctx.game.cards.values()) {
    if (card.zone === ZoneType.Graveyard && card.controllerSeat !== ctx.controller) n += 1;
  }
  return n;
};

countArgRegistry.register("NumCardsInGraveyard", (_ast, ctx) => sumGraveyards(ctx));
countArgRegistry.register("NumCardsInYourGraveyard", (_ast, ctx) => yourGraveyardSize(ctx));
countArgRegistry.register("NumCardsInOppGraveyard", (_ast, ctx) => oppGraveyardSize(ctx));
// Threshold sentinel — Forge sometimes uses CardsInYourGraveyard.
countArgRegistry.register("CardsInYourGraveyard", (_ast, ctx) => yourGraveyardSize(ctx));

// M6.30 — Multikicker / TimesKicked count selectors. Forge's
// `Count$TimesKicked` (Everflowing Chalice's XKicked SVar, Apex Hawks etc.)
// returns Card.getKickerMagnitude() — the number of times Multikicker was
// paid as the source spell was cast. The TS cast pipeline stamps
// `card.kickerCount` from the multikicker pay-loop (see cast-pipeline.ts
// stepDetermineTotalCost). `Count$Multikicker` is the older form some
// corpus scripts use; both alias to the same magnitude.
const kickerMagnitude = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.sourceCardId === undefined) return 0;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  if (!card) return 0;
  return card.kickerCount ?? 0;
};
countArgRegistry.register("TimesKicked", kickerMagnitude);
countArgRegistry.register("Multikicker", kickerMagnitude);

// M6.30 — Imprinted card count. Mirrors Forge's `Count$ImprintedSize`
// (used by cards that branch on whether anything is imprinted, e.g. Chrome
// Mox / Isochron Scepter / Spellweaver Volute). The TS engine stamps
// `card.imprinted` (EntityId[]) at ChangeZone resolution when the SA
// carries `Imprint$ True` (see ability/effects/change-zone.ts:stampSource).
const imprintedSize = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  if (ctx.sourceCardId === undefined) return 0;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  if (!card) return 0;
  return card.imprinted.length;
};
countArgRegistry.register("ImprintedSize", imprintedSize);
countArgRegistry.register("ImprintedNumber", imprintedSize);

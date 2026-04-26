// SPDX-License-Identifier: GPL-3.0-or-later
// UndyingKeywordHandler — processes K:Undying keyword lines (Innistrad;
// CR 702.93) and synthesizes a "leaves the battlefield → graveyard"
// TriggeredAbility on the creature.
//
// CR 702.93a — "Undying": "When this creature is put into a graveyard
// from the battlefield, if it had no +1/+1 counters on it, return it to
// the battlefield under its owner's control with a +1/+1 counter on it."
//
// MVP scope:
//   1. Add "undying" to card.keywords.
//   2. Watch CardChangedZone (Battlefield → Graveyard) for this card.
//   3. On resolve: read card.counters at LKI moment. If PlusOnePlusOne
//      count is 0, clear the counters map (new object), moveTo Graveyard →
//      Battlefield (owner control), addCounter PlusOnePlusOne 1.
//
// Forge form (CardFactoryUtil#L1964):
//   Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard
//   ValidCard$ Card.Self+counters_EQ0_P1P1
//   Effect: ChangeZone Defined$ TriggeredNewCardLKICopy | Origin$ Graveyard
//           Destination$ Battlefield | WithCountersType$ P1P1
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class UndyingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "undying" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("undying");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as {
          cardId: EntityId;
          fromZone: ZoneType;
          toZone: ZoneType;
        };
        return (
          p.cardId === sourceCardId && p.fromZone === ZoneType.Battlefield && p.toZone === ZoneType.Graveyard
        );
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const p1p1 = self.counters?.get(CounterType.PlusOnePlusOne) ?? 0;
          if (p1p1 > 0) return;
          if (self.zone !== ZoneType.Graveyard) return;
          if (self.counters) self.counters.clear();
          yield* g.action.moveTo(sourceCardId, ZoneType.Battlefield, {
            toSeat: self.ownerSeat,
            cause: "undying",
          });
          yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, 1, sourceCardId);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("undying");
  }
}

keywordHandlerRegistry.register(UndyingKeywordHandler);

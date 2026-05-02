// SPDX-License-Identifier: GPL-3.0-or-later
// PersistKeywordHandler — processes K:Persist keyword lines (Shadowmoor;
// CR 702.78) and synthesizes a "leaves the battlefield → graveyard"
// TriggeredAbility on the creature.
//
// CR 702.78a — "Persist": "When this creature is put into a graveyard
// from the battlefield, if it had no -1/-1 counters on it, return it to
// the battlefield under its owner's control with a -1/-1 counter on it."
//
// MVP scope:
//   1. Add "persist" to card.keywords.
//   2. Watch CardChangedZone (Battlefield → Graveyard) for this card.
//   3. On resolve: read card.counters at LKI moment (counters persist
//      across zone changes in our model). If MinusOneMinusOne count is
//      0, clear the counters map (modeling "new object" — the returning
//      permanent has no carry-over counters), moveTo Graveyard →
//      Battlefield (under owner's control), addCounter MinusOneMinusOne 1.
//
// Forge form (CardFactoryUtil#L1662):
//   Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard
//   ValidCard$ Card.Self+counters_EQ0_M1M1
//   Effect: ChangeZone Defined$ TriggeredNewCardLKICopy | Origin$ Graveyard
//           Destination$ Battlefield | WithCountersType$ M1M1
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

export class PersistKeywordHandler extends KeywordHandler {
  static override readonly keyword = "persist" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("persist");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    // M6.9 — pre-zone-change -1/-1 snapshot captured by the matches()
    // hook. CR 122.6 clears counters when a permanent leaves the
    // battlefield, so by the time the resolver runs `card.counters`
    // is empty. Reading the live state would let persist fire forever
    // on a creature that already has -1/-1 (murderous-redcap-etb death
    // loop). We snapshot at match-time (right before the trigger queues)
    // so the resolver gate sees the dying state. Mirrors Forge's
    // `TriggerChangesZone#performTest` LKI capture.
    let hadM1M1AtFire = false;

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
        const matched =
          p.cardId === sourceCardId && p.fromZone === ZoneType.Battlefield && p.toZone === ZoneType.Graveyard;
        if (matched) {
          // M6.9 — read the pre-zone-change -1/-1 count from the LKI
          // snapshot stamped by game-action.ts moveTo BEFORE CR 122.6
          // clears the live counter map. Without this snapshot the
          // resolver would always see counter-count = 0 (since it runs
          // after the clear) and persist would re-fire on a permanent
          // that already has -1/-1 counters, producing the
          // murderous-redcap-etb death loop.
          const snapshot = game.flags.countersAtLeaveBattlefield.get(sourceCardId);
          const m1m1 = snapshot?.get(CounterType.MinusOneMinusOne) ?? 0;
          hadM1M1AtFire = m1m1 > 0;
        }
        return matched;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // M6.9 — read the pre-zone-change -1/-1 snapshot captured by
          // matches() above. Live `self.counters` is empty after CR 122.6
          // counter clear; using it would let persist fire forever on a
          // creature that already has -1/-1 (murderous-redcap-etb death
          // loop). Forge's persist trigger reads LKI at fire time so the
          // counter check sees the dying state.
          if (hadM1M1AtFire) return; // "if it had no -1/-1 counters" — fail.
          if (self.zone !== ZoneType.Graveyard) return; // raced; bail.
          // Clear counters: the returning permanent is a new object.
          if (self.counters) self.counters.clear();
          yield* g.action.moveTo(sourceCardId, ZoneType.Battlefield, {
            toSeat: self.ownerSeat,
            cause: "persist",
          });
          yield* g.action.addCounter(sourceCardId, CounterType.MinusOneMinusOne, 1, sourceCardId);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("persist");
  }
}

keywordHandlerRegistry.register(PersistKeywordHandler);

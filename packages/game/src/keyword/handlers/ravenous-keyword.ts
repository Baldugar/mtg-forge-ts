// SPDX-License-Identifier: GPL-3.0-or-later
// RavenousKeywordHandler — processes K:Ravenous keyword lines (Commander
// Legends: Battle for Baldur's Gate, CR 702.146) and synthesizes an ETB
// trigger that places X +1/+1 counters on the source (X = mana paid for X
// in the casting cost) and draws a card if X >= 5.
//
// CR 702.146a — "Ravenous" — "This creature enters the battlefield with
// X +1/+1 counters on it. If X is 5 or more, draw a card when it enters."
//
// Wave 93 — closes the X-from-cast TODO. The handler now:
//   1. Adds "ravenous" to card.keywords + stamps card.ravenous = true.
//   2. ETB trigger (CardChangedZone → Battlefield): reads source.chosenX
//      (stamped at cast resolution from ctx.xValue, mirroring Earthbend
//      / wave-18-effects), addCounter(P1P1, X), then yields drawCards(1)
//      if X >= 5. The chosenX persists through the cast → ETB transition
//      via the cast pipeline's xValue write to the resolved card slot.
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

export class RavenousKeywordHandler extends KeywordHandler {
  static override readonly keyword = "ravenous" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("ravenous");
    card.ravenous = true;

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
        const p = event.payload as { cardId: EntityId; toZone: ZoneType };
        return p.cardId === sourceCardId && p.toZone === ZoneType.Battlefield;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // CR 702.146a — read X from chosenX (stamped at cast time,
          // mirroring Earthbend's chosenX reader). Defaults to 0 when
          // ravenous source was minted outside a cast pipeline (e.g.
          // direct battlefield placement in tests / replay restore).
          const chosenX = (self as unknown as { chosenX?: number }).chosenX;
          const x = typeof chosenX === "number" && chosenX >= 0 ? chosenX : 0;
          if (x > 0) {
            yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, x, sourceCardId);
          }
          // CR 702.146a — "If X is 5 or more, draw a card when it
          // enters." Routed through the standard drawCards action so the
          // event pipeline + replacement effects observe it normally.
          if (x >= 5) {
            yield* g.action.drawCards(controllerSeat, 1);
          }
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("ravenous");
    card.ravenous = undefined;
  }
}

keywordHandlerRegistry.register(RavenousKeywordHandler);

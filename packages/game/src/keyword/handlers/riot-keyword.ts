// SPDX-License-Identifier: GPL-3.0-or-later
// RiotKeywordHandler — processes K:Riot keyword lines (Ravnica Allegiance,
// CR 702.135) and synthesizes an ETB-time trigger that prompts the
// controller to choose between a +1/+1 counter or haste until end of turn.
//
// CR 702.135a — "Riot (This creature enters the battlefield with your
//   choice of a +1/+1 counter or haste.)"
//
// DSL form:
//   K:Riot
//
// This handler:
//   1. Adds "riot" to card.keywords.
//   2. Synthesizes an ETB trigger (CardChangedZone → Battlefield, =self)
//      that yields a chooseOption decision (counter vs haste). On counter,
//      adds a P1P1 counter via game.action.addCounter; on haste, stamps
//      the keyword `haste` on the card's keyword set as a transient flag
//      (full continuous-effect EOT cleanup is a SP4 polish — for MVP the
//      flag is sticky so combat-haste checks pick it up). A
//      `riotChoseHaste = true` flag captures the choice for tests.
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

export class RiotKeywordHandler extends KeywordHandler {
  static override readonly keyword = "riot" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("riot");

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
          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseOption",
              sourceId: sourceCardId,
              options: [
                { id: "counter", name: "+1/+1 counter" },
                { id: "haste", name: "Haste" },
              ],
            },
          }) as { readonly kind: "chooseOption"; readonly chosenId: string } | undefined;
          const chosen = decision?.chosenId ?? "counter";
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          if (chosen === "haste") {
            if (!self.keywords) self.keywords = new Set();
            self.keywords.add("haste");
            (self as unknown as { riotChoseHaste?: boolean }).riotChoseHaste = true;
          } else {
            yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, 1, sourceCardId);
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
    card?.keywords?.delete("riot");
  }
}

keywordHandlerRegistry.register(RiotKeywordHandler);

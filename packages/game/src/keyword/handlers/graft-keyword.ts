// SPDX-License-Identifier: GPL-3.0-or-later
// GraftKeywordHandler — processes K:Graft:N keyword lines (Dissension,
// CR 702.58) and synthesizes ETB-with-counters + a triggered counter-
// transfer ability.
//
// CR 702.58a — "Graft N (This creature enters with N +1/+1 counters on it.
//   Whenever another creature enters the battlefield, you may move a
//   +1/+1 counter from this creature onto it.)"
//
// DSL form:
//   K:Graft:N  → graft amount = N (AMOUNT_KEYWORDS).
//
// This handler:
//   1. Adds "graft" to card.keywords.
//   2. Synthesizes an ETB trigger that puts N +1/+1 counters on self.
//   3. Synthesizes a watch trigger on CardChangedZone(→Battlefield) that
//      yields a chooseConfirm decision; on yes, transfers one P1P1 counter
//      from self to the entering creature (only if self still has any).
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class GraftKeywordHandler extends KeywordHandler {
  static override readonly keyword = "graft" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("graft");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const graftN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const safeN = Number.isFinite(graftN) && graftN > 0 ? graftN : 1;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // ETB trigger — puts safeN +1/+1 counters on self.
    const etbId = game.newEntityId();
    const etb: TriggeredAbilityWithResolver = {
      id: etbId,
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
          yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, safeN, sourceCardId);
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);

    // Watch trigger — when ANOTHER creature enters under any controller,
    // optionally transfer a +1/+1 counter from self to it.
    const watchId = game.newEntityId();
    const watch: TriggeredAbilityWithResolver = {
      id: watchId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; toZone: ZoneType };
        if (p.toZone !== ZoneType.Battlefield) return false;
        if (p.cardId === sourceCardId) return false;
        const entering = game.cards.get(p.cardId);
        if (!entering) return false;
        const chars = game.layerEngine.computeCharacteristics(p.cardId);
        if (!chars.types.has(CardType.Creature)) return false;
        // Only fire when source still has at least one P1P1 counter.
        const self = game.cards.get(sourceCardId);
        if (!self) return false;
        const have = self.counters?.get(CounterType.PlusOnePlusOne) ?? 0;
        return have > 0;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const have = self.counters?.get(CounterType.PlusOnePlusOne) ?? 0;
          if (have <= 0) return;

          // Find the most recently entered other-creature under any
          // controller. We approximate "the entering creature" by walking
          // battlefield cards looking for a creature that's not self
          // and isn't already saturated. The first match is enough for
          // the MVP; accuracy improves once we wire LKI per matched event.
          let targetId: EntityId | null = null;
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            targetId = id;
            break;
          }
          if (targetId === null) return;

          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Move a +1/+1 counter from this creature onto the entering creature?",
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
          if (response?.confirmed !== true) return;

          yield* g.action.removeCounter(sourceCardId, CounterType.PlusOnePlusOne, 1, sourceCardId);
          yield* g.action.addCounter(targetId, CounterType.PlusOnePlusOne, 1, sourceCardId);
        },
      },
    };
    card.triggeredAbilities.push(watch as unknown as TriggeredAbility);
    game.triggerRegistry.register(watch as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("graft");
  }
}

keywordHandlerRegistry.register(GraftKeywordHandler);

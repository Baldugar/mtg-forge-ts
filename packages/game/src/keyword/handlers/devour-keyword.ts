// SPDX-License-Identifier: GPL-3.0-or-later
// DevourKeywordHandler — processes K:Devour:N keyword lines (Alara Reborn,
// CR 702.81) and synthesizes an ETB trigger that asks the controller to
// sacrifice any number of creatures, then stamps N +1/+1 counters per
// sacrificed creature on this permanent.
//
// CR 702.81a — "Devour N (As this creature enters the battlefield, you
// may sacrifice any number of creatures. This creature enters the
// battlefield with N +1/+1 counters on it for each creature sacrificed
// this way.)"
//
// DSL form:
//   K:Devour:1   → devour amount = 1 (most common form)
//   K:Devour:N   → devour amount = N
//
// MVP scope:
//   1. Adds "devour" to card.keywords.
//   2. Synthesizes an ETB trigger (CardChangedZone Any → Battlefield,
//      cardId === self) that yields a chooseCard decision over creatures
//      the controller controls (excluding self), with min=0, max=N (any
//      number). For each chosen creature, calls game.action.sacrifice and
//      then stamps `(chosen.length × N)` PlusOnePlusOne counters on self.
//
// "As it enters" is technically an ETB-replacement; the MVP uses an ETB
// trigger that fires after the entry and then adds counters and sacrifices.
// The visible game-state difference (counters present on first SBA check
// vs. on resolution) is observed by very few cards and is a SP4 polish.
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

export class DevourKeywordHandler extends KeywordHandler {
  static override readonly keyword = "devour" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("devour");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const devourN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const safeN = Number.isFinite(devourN) && devourN > 0 ? devourN : 1;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

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
          // Eligible: creatures the controller controls excluding self.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "devour", n: safeN },
              min: 0,
              max: eligible.length,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const chosen = decision.chosen;
          if (chosen.length === 0) return;

          for (const victimId of chosen) {
            if (!eligible.includes(victimId)) continue;
            yield* g.action.sacrifice(victimId, { sourceId: sourceCardId });
          }
          const counters = chosen.length * safeN;
          if (counters > 0) {
            yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, counters, sourceCardId);
          }
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("devour");
  }
}

keywordHandlerRegistry.register(DevourKeywordHandler);

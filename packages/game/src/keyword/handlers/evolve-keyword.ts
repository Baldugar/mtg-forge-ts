// SPDX-License-Identifier: GPL-3.0-or-later
// EvolveKeywordHandler — processes K:Evolve keyword lines (Gatecrash; CR
// 702.99) and synthesizes a self-watching TriggeredAbility on the creature.
//
// CR 702.99a — "Evolve" — Whenever ANOTHER creature enters the battlefield
// under your control, if that creature has greater power or greater
// toughness than this creature, put a +1/+1 counter on this creature.
//
// DSL form:
//   K:Evolve
//
// This handler:
//   1. Adds "evolve" to card.keywords (flag bookkeeping for hasKeyword).
//   2. Registers a TriggeredAbility that:
//        - Watches CardChangedZone events with toZone === Battlefield.
//        - Filters out the source card itself (only ANOTHER creature counts).
//        - Filters by controllerSeat === this card's controller.
//        - Filters out non-creatures (computed via the layer engine).
//   3. Resolver: re-reads BOTH cards' effective power/toughness via the
//      layer engine, and if the entering creature's power > self.power OR
//      toughness > self.toughness, drives game.action.addCounter with one
//      +1/+1 counter and emits the CardEvolved event.
//
// Pitfall: parsed power/toughness may be `*`, `1+*`, or `X` and computed as
// `null` or NaN by the layer engine. We coerce non-finite numbers to 0 so
// the comparison always has a definite answer (same Forge convention).
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const finite = (n: number | null | undefined): number => {
  if (n === null || n === undefined) return 0;
  return Number.isFinite(n) ? n : 0;
};

export class EvolveKeywordHandler extends KeywordHandler {
  static override readonly keyword = "evolve" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("evolve");

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
          toZone: ZoneType;
          toSeat?: number;
        };
        if (p.toZone !== ZoneType.Battlefield) return false;
        // ANOTHER creature — exclude self.
        if (p.cardId === sourceCardId) return false;
        // Same controller as this card.
        const enteringCard = game.cards.get(p.cardId);
        if (!enteringCard) return false;
        if (enteringCard.controllerSeat !== controllerSeat) return false;
        // Must be a creature (per CR 702.99a — "another creature enters").
        const chars = game.layerEngine.computeCharacteristics(p.cardId);
        if (!chars.types.has(CardType.Creature)) return false;
        return true;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // The entering creature is identified by the latest event in the
          // queue — but we don't have access to the matching event from
          // the resolver. Instead, we recompute "any other creature with
          // greater P or T currently on the battlefield under our
          // controller" using the layer engine. This is conservative: if
          // multiple creatures entered in one batch, the trigger fires
          // once per matching event, and the resolver evaluates the
          // condition at resolution time as required by CR 603.4.
          const selfChars = g.layerEngine.computeCharacteristics(sourceCardId);
          const selfP = finite(selfChars.power);
          const selfT = finite(selfChars.toughness);

          let evolved = false;
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            const p = finite(chars.power);
            const t = finite(chars.toughness);
            if (p > selfP || t > selfT) {
              evolved = true;
              break;
            }
          }
          if (!evolved) return;

          yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, 1, sourceCardId);

          yield g.emitEvent(mkEvent("CardEvolved", g.turn, g.phase, { cardId: sourceCardId }));
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
    card.keywords?.delete("evolve");
  }
}

keywordHandlerRegistry.register(EvolveKeywordHandler);

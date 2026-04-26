// SPDX-License-Identifier: GPL-3.0-or-later
// VanishingKeywordHandler — processes K:Vanishing:N keyword lines (Time
// Spiral; CR 702.61) and synthesizes ETB-with-counters + upkeep-removal
// triggers on the permanent.
//
// CR 702.61a — "Vanishing N": "This permanent enters the battlefield with
// N time counters on it. At the beginning of your upkeep, remove a time
// counter from it. When the last is removed, sacrifice it."
//
// MVP scope:
//   1. Add "vanishing" to card.keywords.
//   2. ETB trigger: addCounter Time N to self.
//   3. Upkeep trigger (Phase=Upkeep + activeSeat=controller): if has
//      Time counter, remove one; if that brought the count to 0,
//      sacrifice self.
import type {
  GameEvent,
  KeywordAst,
  ParamValue,
  PhaseStep,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class VanishingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "vanishing" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("vanishing");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const nRaw =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const N = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 1;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // ETB trigger — addCounter Time N on self.
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
        const p = event.payload as { cardId: import("@mtg-forge-ts/core").EntityId; toZone: ZoneType };
        return p.cardId === sourceCardId && p.toZone === ZoneType.Battlefield;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          yield* g.action.addCounter(sourceCardId, CounterType.Time, N, sourceCardId);
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);

    // Upkeep trigger — remove a Time counter; sacrifice on last.
    const upkeepId = game.newEntityId();
    const upkeep: TriggeredAbilityWithResolver = {
      id: upkeepId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "StepStarted") return false;
        const { step, activeSeat } = event.payload as { step: PhaseStep; activeSeat: PlayerSeat };
        if (step !== ("Upkeep" as PhaseStep)) return false;
        return activeSeat === controllerSeat;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          const have = c.counters?.get(CounterType.Time) ?? 0;
          if (have <= 0) return; // no counters — trigger is no-op (the
          // sac-on-last semantic is "when last removed", which is below).
          yield* g.action.removeCounter(sourceCardId, CounterType.Time, 1, sourceCardId);
          // Re-read after the remove. If we just removed the last counter,
          // CR 702.61a's "When the last is removed, sacrifice it" fires.
          const after = c.counters?.get(CounterType.Time) ?? 0;
          if (after <= 0) {
            yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
          }
        },
      },
    };
    card.triggeredAbilities.push(upkeep as unknown as TriggeredAbility);
    game.triggerRegistry.register(upkeep as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("vanishing");
  }
}

keywordHandlerRegistry.register(VanishingKeywordHandler);

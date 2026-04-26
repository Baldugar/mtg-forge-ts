// SPDX-License-Identifier: GPL-3.0-or-later
// FadingKeywordHandler — processes K:Fading:N keyword lines (Urza's Saga;
// CR 702.32) and synthesizes ETB-with-counters + upkeep-removal triggers.
//
// CR 702.32a — "Fading N": "This permanent enters the battlefield with N
// fade counters on it. At the beginning of your upkeep, remove a fade
// counter from it. If you can't, sacrifice it."
//
// Difference vs. Vanishing: Fading sacrifices when you CAN'T remove a
// counter (i.e., already 0). Vanishing sacrifices when the LAST counter
// is removed (i.e., reached 0 via the upkeep removal). Functionally
// equivalent here because both cards enter with N counters (so neither
// fires "can't remove" until N upkeeps have passed); the inline trigger
// implements the strict CR semantic for symmetry with Forge's wiring.
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

export class FadingKeywordHandler extends KeywordHandler {
  static override readonly keyword = "fading" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("fading");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const nRaw =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const N = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 1;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // ETB trigger — addCounter Fade N on self.
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
          yield* g.action.addCounter(sourceCardId, CounterType.Fade, N, sourceCardId);
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);

    // Upkeep trigger — remove a Fade counter; sacrifice if you can't.
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
          const have = c.counters?.get(CounterType.Fade) ?? 0;
          if (have <= 0) {
            // Can't remove — sacrifice (CR 702.32a).
            yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
            return;
          }
          yield* g.action.removeCounter(sourceCardId, CounterType.Fade, 1, sourceCardId);
        },
      },
    };
    card.triggeredAbilities.push(upkeep as unknown as TriggeredAbility);
    game.triggerRegistry.register(upkeep as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("fading");
  }
}

keywordHandlerRegistry.register(FadingKeywordHandler);

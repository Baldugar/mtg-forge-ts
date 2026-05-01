// SPDX-License-Identifier: GPL-3.0-or-later
// BloodthirstKeywordHandler — processes K:Bloodthirst:N keyword lines
// (Guildpact, CR 702.53) and synthesizes an ETB trigger that, if any
// opponent took damage this turn, puts N +1/+1 counters on self.
//
// CR 702.53a — "Bloodthirst N" — "If an opponent was dealt damage this
// turn, this creature enters with N +1/+1 counters on it."
//
// DSL form:
//   K:Bloodthirst:1     → N = 1
//   K:Bloodthirst:3     → N = 3
//   K:Bloodthirst:X     → variable amount; X resolves at trigger-resolve
//                         time to the maximum life lost this turn across
//                         all opponents (CR 702.53b: "X equals the amount
//                         of damage dealt to opponents this turn"). The
//                         engine reads `game.flags.lifeLostThisTurn` —
//                         the closest fidelity-equivalent counter, since
//                         every damage event funnels through changeLife.
//
// Scope:
//   1. Adds "bloodthirst" to card.keywords.
//   2. ETB trigger checks `game.flags.lifeLostThisTurn[opp] >= 1` for any
//      opponent. If so, addCounter(+1/+1, N) on self where N is the
//      literal amount, or — for K:Bloodthirst:X — the maximum
//      `lifeLostThisTurn` across all opponents.
//
// Note: this is implemented as an ETB trigger rather than a true ETB-
// with-counters replacement (CR 614.1c). Forge implements it as both
// shapes; the trigger shape is simpler and fires before SBA so the
// counters are observable immediately.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class BloodthirstKeywordHandler extends KeywordHandler {
  static override readonly keyword = "bloodthirst" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("bloodthirst");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawAmount = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";
    // K:Bloodthirst:X marker — when the amount literal is "X" (any case),
    // resolve N at trigger-resolve time as the max life-lost-this-turn
    // across opponents. Otherwise parse the literal at activate time.
    const isVariable = rawAmount.trim().toUpperCase() === "X";
    const literalN = Number.parseInt(rawAmount, 10);
    const fixedN = !isVariable && Number.isFinite(literalN) && literalN > 0 ? literalN : 1;

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
          // CR 702.53a — "if an opponent was dealt damage this turn".
          // Read game.flags.lifeLostThisTurn for any opponent — Wave 51's
          // changeLife already increments this map under cause "damage".
          let any = false;
          let maxLost = 0;
          for (const player of g.players) {
            if (player.seat === controllerSeat) continue;
            const lost = g.flags.lifeLostThisTurn.get(player.seat) ?? 0;
            if (lost >= 1) any = true;
            if (lost > maxLost) maxLost = lost;
          }
          if (!any) return;
          // For K:Bloodthirst:X — N is the max damage dealt to any
          // opponent this turn (CR 702.53b X-variant). Otherwise N is
          // the parsed literal.
          const n = isVariable ? maxLost : fixedN;
          if (n <= 0) return;
          yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, n, sourceCardId);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("bloodthirst");
  }
}

keywordHandlerRegistry.register(BloodthirstKeywordHandler);

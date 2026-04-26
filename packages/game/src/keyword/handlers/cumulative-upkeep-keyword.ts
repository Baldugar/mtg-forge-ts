// SPDX-License-Identifier: GPL-3.0-or-later
// CumulativeUpkeepKeywordHandler — processes K:CumulativeUpkeep:<cost>
// keyword lines (Ice Age, CR 702.24) and synthesizes a battlefield-zone
// TriggeredAbility.
//
// CR 702.24 — "Cumulative upkeep [cost]" — At the beginning of your upkeep,
// put an age counter on this permanent. Then you may pay [cost] for each
// age counter on it. If you don't, sacrifice it.
//
// DSL form:
//   K:CumulativeUpkeep:1     → cumulative upkeep {1}
//   K:CumulativeUpkeep:G     → cumulative upkeep {G}
//
// This handler:
//   1. Adds "cumulative_upkeep" to card.keywords (and "cumulative-upkeep"
//      string for human-readable lookups).
//   2. Stamps `card.ageCounters` to 0 if undefined (initial entry-time
//      bookkeeping). Each upkeep firing increments by 1 before the pay
//      decision.
//   3. Synthesizes an upkeep TriggeredAbility:
//        - matches StepStarted{step:Upkeep, activeSeat:controller},
//        - on resolve: bump ageCounters, yield confirmAction "pay
//          (cost × counters) OR sacrifice".
//
// MVP scope: as with Echo, the resolver does not invoke the full mana-
// payment pipeline; it just stamps the engine event PayCumulativeUpkeep on
// success or sacrifices on decline.
import type {
  GameEvent,
  KeywordAst,
  ParamValue,
  PhaseStep,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class CumulativeUpkeepKeywordHandler extends KeywordHandler {
  static override readonly keyword = "cumulative_upkeep" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("cumulative_upkeep");

    if (card.ageCounters === undefined) card.ageCounters = 0;

    const costParam = ast.params?.cost as ParamValue | undefined;
    const cuCostRaw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

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
        if (event.kind !== "StepStarted") return false;
        const { step, activeSeat } = event.payload as {
          step: PhaseStep;
          activeSeat: PlayerSeat;
        };
        if (step !== ("Upkeep" as PhaseStep)) return false;
        return activeSeat === controllerSeat;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          // 1. Bump age counters by 1.
          c.ageCounters = (c.ageCounters ?? 0) + 1;
          const total = c.ageCounters;

          // 2. Yield confirm: pay (cost × age) OR sacrifice.
          const decision = yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Pay cumulative upkeep {${cuCostRaw}} × ${total}? (otherwise sacrifice)`,
            },
          };
          const r = decision as { kind: string; confirmed?: boolean };
          const willPay = r.kind === "confirmAction" && r.confirmed === true;

          if (willPay) {
            yield g.emitEvent(
              mkEvent("PayCumulativeUpkeep", g.turn, g.phase, {
                cardId: sourceCardId,
                playerSeat: controllerSeat,
              }),
            );
          } else {
            yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
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
    card.keywords?.delete("cumulative_upkeep");
  }
}

keywordHandlerRegistry.register(CumulativeUpkeepKeywordHandler);

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
// Wave 29 — full mana-payment loop wired in (mirror of Echo). The cost is
// scaled by age counters: a base cost of "1 R" with 3 age counters yields
// a payment of "3 3 R" (3× generic added) — Forge multiplies the base
// cost by the counter total. Multiplication is implemented by repeating
// the base cost segments N times into the comma-joined plan input.
import type {
  GameEvent,
  KeywordAst,
  ParamValue,
  PhaseStep,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { CostPaymentContext } from "../../cost/parts/cost-part.js";
import { parseCostString, payCost } from "../../cost/parts/cost-payment.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

/**
 * Build a CostPlan input string from a base cost token (e.g. "1 R") and
 * a multiplier N. The cost-payment parser supports comma-separated
 * segments — repeating the segment N times means each base segment is
 * paid N times, which is the correct semantics for cumulative upkeep
 * (CR 702.24a: "pay [cost] for each age counter").
 */
const scaleCostByCounters = (baseCost: string, n: number): string => {
  if (n <= 0) return "";
  const trimmed = baseCost.trim();
  if (trimmed === "") return "";
  return Array.from({ length: n }, () => trimmed).join(", ");
};

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
            // Wave 29 — full mana-payment loop. Scale the base cost by
            // the current age counter total, parse, pay. On solver
            // failure (throws inside CostMana.pay) we fall through to
            // sacrifice so the player still receives the canonical
            // CR 702.24 outcome ("if you don't, sacrifice it").
            let paid = false;
            const scaled = scaleCostByCounters(cuCostRaw, total);
            try {
              const plan = parseCostString(scaled);
              const ctx: CostPaymentContext = {
                game: g,
                payerSeat: controllerSeat,
                sourceCardId,
                raw: scaled,
                kind: "ability",
                sourceZone: ZoneType.Battlefield,
              };
              yield* payCost(plan, ctx);
              paid = true;
            } catch {
              paid = false;
            }
            if (paid) {
              yield g.emitEvent(
                mkEvent("PayCumulativeUpkeep", g.turn, g.phase, {
                  cardId: sourceCardId,
                  playerSeat: controllerSeat,
                }),
              );
            } else {
              yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
            }
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

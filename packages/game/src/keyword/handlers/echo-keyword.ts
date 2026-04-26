// SPDX-License-Identifier: GPL-3.0-or-later
// EchoKeywordHandler — processes K:Echo:<cost> keyword lines (Urza block,
// CR 702.30) and synthesizes a battlefield-zone TriggeredAbility.
//
// CR 702.30a — "Echo [cost]" — At the beginning of your upkeep, if this
// permanent came under your control since the beginning of your last
// upkeep, sacrifice it unless you pay its echo cost.
//
// DSL form:
//   K:Echo:1 R       → echo cost {1}{R}
//   K:Echo:U         → echo cost {U}
//
// This handler:
//   1. Adds "echo" to card.keywords.
//   2. Stamps `card.echoOwedCost = <cost>` so the upkeep trigger has
//      something to read. (Forge stamps this on entry; the layer/zone-
//      activation system in this engine calls activateKeywordsFromDefinition
//      on every battlefield ETB so this happens implicitly each time.)
//   3. Synthesizes an upkeep TriggeredAbility, registered with
//      game.triggerRegistry, that fires on the controller's upkeep when
//      `echoOwedCost` is set.
//
// Wave 29 — full mana-payment loop wired in. Resolution flow:
//   1. yield confirmAction: pay or sacrifice.
//   2. on confirm-pay: parseCostString(echoOwedCost) → CostPlan; yield*
//      payCost. If the mana solver returns null (insufficient), payCost
//      throws; we catch and fall through to the sacrifice arm so a
//      mis-confirmed pay (e.g. AI agent without mana available) doesn't
//      corrupt the game state.
//   3. on success: clear card.echoOwedCost; emit PayCumulativeUpkeep
//      (PayEcho-specific event remains TODO until the event registry
//      gains a kind for it).
//   4. on confirm-sacrifice: clear echoOwedCost and game.action.sacrifice.
//
// The "came under your control since last upkeep" check: this MVP
// simply consults `echoOwedCost` (set on ETB; cleared on the FIRST
// upkeep after a successful payment). This means Echo fires each
// upkeep until paid or the card leaves play — close enough to the
// correct semantics for permanents that ETB and stay put.
//
// Wave 41 — control-since-tracking upgrade. The match predicate
// gates on `card.controllerSeat` (the LIVE controller) rather than
// `controllerSeatAtReg` (the closure capture from the original ETB).
// This means a creature that changes controllers — Mind Control,
// Threaten, etc. — fires Echo on the new controller's NEXT upkeep,
// matching CR 702.30b. The owed cost slot is shared (set when the
// permanent first ETBs and persisted across control changes); the
// fix is purely in the trigger predicate.
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

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class EchoKeywordHandler extends KeywordHandler {
  static override readonly keyword = "echo" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("echo");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const echoCostRaw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.echoOwedCost = echoCostRaw;

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
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
        // Wave 41 — gate on the LIVE controller (CR 702.30b: "if this
        // permanent came under your control since the beginning of your
        // last upkeep"). controllerSeatAtReg captured the original
        // controller; if the card has since changed hands (Mind Control,
        // Threaten), Echo should fire on the NEW controller's upkeep.
        if (activeSeat !== c.controllerSeat) return false;
        return c.echoOwedCost !== undefined;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          const cost = c.echoOwedCost;
          if (cost === undefined) return;

          // Yield a confirmAction: pay echo cost OR sacrifice. The
          // controller's response decides which arm runs.
          const decision = yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Pay echo {${cost}}? (otherwise sacrifice)`,
            },
          };
          const r = decision as { kind: string; confirmed?: boolean };
          const willPay = r.kind === "confirmAction" && r.confirmed === true;

          // Wave 41 — pay/emit using the LIVE controller (post-control-
          // change), matching the upkeep gate above. controllerSeatAtReg
          // is preserved on the trigger record for replay forensics but
          // the active payer is whoever currently controls the card.
          const livePayer = c.controllerSeat;
          if (willPay) {
            // Wave 29 — full mana-payment loop. parseCostString returns a
            // CostPlan; payCost yields through the cost-payment infra
            // (mana solver, X bind, ManaSpent emits, …). On payment
            // failure (insufficient mana) the solver throws inside
            // CostMana.pay; we treat that as a fall-through to the
            // sacrifice arm so a mis-confirmed pay can't strand state.
            let paid = false;
            try {
              const plan = parseCostString(cost);
              const ctx: CostPaymentContext = {
                game: g,
                payerSeat: livePayer,
                sourceCardId,
                raw: cost,
                kind: "ability",
                sourceZone: ZoneType.Battlefield,
              };
              yield* payCost(plan, ctx);
              paid = true;
            } catch {
              paid = false;
            }
            if (paid) {
              c.echoOwedCost = undefined;
              yield g.emitEvent(
                mkEvent("PayCumulativeUpkeep", g.turn, g.phase, {
                  cardId: sourceCardId,
                  playerSeat: livePayer,
                }),
              );
            } else {
              c.echoOwedCost = undefined;
              yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
            }
          } else {
            // Sacrifice the permanent. Clear the owed cost so re-entry under
            // control later re-stamps freshly.
            c.echoOwedCost = undefined;
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
    card.keywords?.delete("echo");
  }
}

keywordHandlerRegistry.register(EchoKeywordHandler);

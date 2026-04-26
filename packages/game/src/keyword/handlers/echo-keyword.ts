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
// MVP scope:
//   - Resolution emits a `confirmAction` decision: pay the echo cost OR
//     sacrifice the permanent. The full mana-cost-payment flow is wired
//     into Echo in a follow-up; for Wave 26 the trigger fires and stamps
//     the engine event PayCumulativeUpkeep on success or sacrifices on
//     failure (using game.action.sacrifice).
//   - The "came under your control since last upkeep" check: this MVP
//     simply consults `echoOwedCost` (set on ETB; cleared on the FIRST
//     upkeep after a successful payment). This means Echo fires each
//     upkeep until paid or the card leaves play — close enough to the
//     correct semantics for permanents that ETB and stay put.
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
        if (activeSeat !== controllerSeat) return false;
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
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

          if (willPay) {
            // MVP: fold the cost-payment into a PayCumulativeUpkeep event.
            // (PayEcho-style engine event already wired through wave-22.)
            c.echoOwedCost = undefined;
            yield g.emitEvent(
              mkEvent("PayCumulativeUpkeep", g.turn, g.phase, {
                cardId: sourceCardId,
                playerSeat: controllerSeat,
              }),
            );
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

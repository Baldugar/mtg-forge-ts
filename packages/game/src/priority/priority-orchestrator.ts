// SPDX-License-Identifier: GPL-3.0-or-later
// CR 117.1 — priority-window orchestrator.
//
// Before a player gets priority the game must:
//   (a) perform all applicable state-based actions as a single event, then
//       keep looping because a just-applied SBA can spawn triggers or flip
//       the conditions that enable another SBA;
//   (b) set all triggered abilities that have triggered since the last SBA
//       check on the stack in APNAP order (CR 603.3b);
//   (c) drain any continuous effects whose duration expired during (a)/(b)
//       so `ContinuousEffectExpired` observers see their one event per
//       expiry. The registry buffers these between drains.
// …and repeat (a)/(b)/(c) until none of them did anything. THEN the active
// player (current priority holder) is yielded a `priority` decision with
// the enumerated legal actions.
//
// The caller (the run-game driver / match generator in SP3) routes the
// returned priority decision's action:
//   - "pass"          → next stack item resolves, or the phase progresses.
//   - "castSpell"     → CastPipeline.run for the picked card.
//   - "activateAbility" → activated-ability resolver (SP3).
//   - "playLand"      → land-play special action (CR 305.1).
//   - "concede"       → terminal.
//
// MAX_ITERATIONS catches pathological input (a buggy SBA collector that
// re-emits the same action every sweep without mutating state, an event
// loop that re-queues its own trigger forever). MTG is not a self-
// sustaining system: rule-legal setups always terminate a priority window.
import type { DecisionRequest, DecisionResponse, PriorityAction } from "@mtg-forge-ts/core";
import { IllegalDecisionError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { StackItem, StackItemResolver } from "../stack/stack-item.js";
import { apnapOrder } from "../triggers/apnap-orderer.js";
import { enumerateLegalActions } from "./legal-action-enumerator.js";

/**
 * Final return value of `runPriorityWindow`. The orchestrator delegates
 * action routing back to the caller (driver / match loop / pipeline).
 */
export interface PriorityResponse {
  readonly action: PriorityAction;
}

// WHY bounded: every iteration must strictly reduce one of {SBA fixpoint,
// pending-trigger count, expired-effect count}. 200 is generous relative
// to any realistic chain (Forge's deepest observed cascade in corpus is
// ~ a few dozen); exceeding this is an engine bug, not a game-legal state.
const MAX_ITERATIONS = 200;

/**
 * Drive one priority window on the supplied Game. Yields SBA events,
 * `TriggerQueued` events (one per trigger stacked), and
 * `ContinuousEffectExpired` events (one per expired effect) as they
 * happen, then yields a single `priority` decision and returns the
 * controller's response wrapped as PriorityResponse.
 *
 * The priority holder is the game's current `activePlayer` — SP2 does not
 * yet rotate priority through non-active players between stack pushes;
 * that responsibility lies with the driver loop that repeatedly calls this
 * generator.
 */
export function* runPriorityWindow(game: Game): Generator<EngineYield, PriorityResponse, unknown> {
  // Drain-loop: keep sweeping SBAs + triggers + expired effects until a
  // full iteration does nothing. CR 117.1 specifies this must reach a
  // fixed point before offering priority.
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let didSomething = false;

    // (a) SBA sweep — itself a fixpoint over its own collectors.
    const sbaBatches = yield* game.sbaEngine.sweep();
    if (sbaBatches.length > 0) didSomething = true;

    // (b) Drain triggers + APNAP order + push to the stack. Each push
    // yields a `TriggerQueued` event so consumers (replay logs, UI) see
    // triggers accumulate in the correct order.
    const pending = game.triggerRegistry.drain();
    if (pending.length > 0) {
      const seats = game.players.map((p) => p.seat);
      const ordered = yield* apnapOrder(pending, game.activePlayer, seats);
      for (const pt of ordered) {
        // SP2 Task 78 (fix 4) — attach a default resolver to the pushed
        // stack item so resolveStackItem can drive the trigger's body.
        // Resolver comes from the TriggeredAbility itself (if it defined
        // one at registration time) — TriggeredAbility's shape in core
        // doesn't carry a resolver field, but the game-level trigger
        // factories often stamp one on via a structural extension.
        // Duck-typed read here keeps core free of the game-side
        // StackItemResolver type (no core->game circular import).
        const trigger = game.triggerRegistry.getTrigger(pt.triggerId);
        const triggerResolver =
          (trigger as { readonly resolver?: StackItemResolver | null } | undefined)?.resolver ?? null;
        const stackItem: StackItem = {
          id: game.newEntityId(),
          sourceCardId: pt.sourceCardId,
          controllerSeat: pt.sourceControllerAtFire,
          kind: "triggeredAbility",
          isCast: false,
          targets: null,
          modes: [],
          xValue: null,
          costPaid: null,
          // Provenance on a triggered ability: the source's "origin zone"
          // is where it sat when the trigger fired (usually Battlefield
          // for "enters" / "dies" / "attacks" hooks). We capture it off
          // the LKI when present; otherwise read the live card. Falls
          // back to Battlefield because SP2 triggered abilities active-
          // zone set is {Battlefield} for every currently-scripted
          // source (zone-change triggers carry their own LKI zone).
          provenance: {
            originZone:
              pt.lki?.zone ??
              game.cards.get(pt.sourceCardId)?.zone ??
              // Fallback: no LKI + card not tracked (emblem, deleted token).
              // Triggered abilities default to Battlefield origin for SP2-
              // era sources; the stack zone tag is used when even the card
              // registry has no record.
              game.sharedZones.stack.type,
            altCostUsed: null,
            additionalCostsPaid: [],
          },
          triggerId: pt.triggerId,
          lki: pt.lki,
          // SP2 Task 78 (fix 4): stack-top resolver; resolveStackItem
          // (Task 67) drives this when the item resolves. `null` when
          // the trigger didn't specify one — SP3's full ability DSL
          // populates default resolvers.
          event: pt.event,
          resolver: triggerResolver,
        };
        game.sharedZones.stack.push(stackItem);
        yield {
          kind: "event",
          event: mkEvent("TriggerQueued", game.turn, game.phase, {
            triggerId: pt.triggerId,
            sourceCardId: pt.sourceCardId,
          }),
        };
      }
      didSomething = true;
    }

    // (c) Drain any continuous effects whose duration expired during the
    // prior mutation. The registry already unregistered them; we just
    // surface one ContinuousEffectExpired event per entry.
    const expired = game.continuousEffectRegistry.drainExpired();
    if (expired.length > 0) {
      for (const e of expired) {
        yield {
          kind: "event",
          event: mkEvent("ContinuousEffectExpired", game.turn, game.phase, {
            effectId: e.id,
          }),
        };
      }
      didSomething = true;
    }

    if (!didSomething) break;
    if (iter === MAX_ITERATIONS - 1) {
      throw new Error(
        `runPriorityWindow: exceeded ${MAX_ITERATIONS} iterations — likely engine bug (self-sustaining SBA collector, unbounded trigger queue, or expiry loop).`,
      );
    }
  }

  // The active player is the priority holder for this window (SP2 scope).
  // Milestone S extends the driver to rotate through non-active seats
  // between stack pushes.
  const seat = game.activePlayer;
  const legalActions = enumerateLegalActions(game, seat);
  const request: DecisionRequest = {
    kind: "priority",
    playerSeat: seat,
    legalActions,
  };
  const response = (yield { kind: "decision", request }) as DecisionResponse;
  if (response.kind !== "priority") {
    throw new IllegalDecisionError(`runPriorityWindow: expected priority response, got ${response.kind}`);
  }
  return { action: response.action };
}

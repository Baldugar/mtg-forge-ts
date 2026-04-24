// SPDX-License-Identifier: GPL-3.0-or-later
// CR 611 — continuous-effect duration evaluation.
//
// A continuous effect expires when its duration's trigger fires. Each
// duration kind maps to a specific firing:
//
//   - permanent              never.
//   - untilEndOfTurn         TurnEnded event (CR 514.3 cleanup step wipe).
//   - untilEndOfYourNextTurn TurnEnded event where activeSeat === forSeat
//                            AND the enveloping turn > registeredAtTurn
//                            (effects registered during forSeat's current
//                            turn survive that turn's end; they expire the
//                            NEXT time forSeat's turn ends).
//   - untilXLeavesBattlefield CardChangedZone event for xId with
//                            fromZone === Battlefield.
//   - untilCombatEnds         CombatEnded event.
//   - untilEndOfNextStep      PhaseStepEnded event matching the target step.
//   - asLongAs                condition AST evaluates to false
//                             (re-checked on every event feed + on epoch
//                             bumps so state changes surfaced by the layer
//                             engine immediately invalidate the effect).
//
// ExpiryContext carries either the GameEvent that may cause expiry, or a
// synthetic "epochBump" marker used by the registry when the layer engine
// re-evaluates (re-checking asLongAs after a board change).
import type { ContinuousEffect, GameEvent } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { evalCondition } from "./condition-evaluator.js";

export type ExpiryContext =
  | { readonly kind: "event"; readonly event: GameEvent }
  | { readonly kind: "epochBump" };

export const isExpired = (effect: ContinuousEffect, ctx: ExpiryContext, game: Game): boolean => {
  const d = effect.duration;
  switch (d.kind) {
    case "permanent":
      return false;
    case "untilEndOfTurn":
      return ctx.kind === "event" && ctx.event.kind === "TurnEnded";
    case "untilEndOfYourNextTurn": {
      if (ctx.kind !== "event" || ctx.event.kind !== "TurnEnded") return false;
      // TurnEnded payload carries activeSeat; the enveloping event.turn
      // gives the turn number that just ended. The effect was registered
      // at `registeredAtTurn` — if that happened DURING forSeat's own
      // turn, the effect must survive that turn's end and expire the
      // NEXT time forSeat's turn ends.
      if (ctx.event.payload.activeSeat !== d.forSeat) return false;
      return ctx.event.turn > d.registeredAtTurn;
    }
    case "untilXLeavesBattlefield": {
      if (ctx.kind !== "event" || ctx.event.kind !== "CardChangedZone") return false;
      const p = ctx.event.payload;
      return p.cardId === d.xId && p.fromZone === ZoneType.Battlefield;
    }
    case "untilCombatEnds":
      return ctx.kind === "event" && ctx.event.kind === "CombatEnded";
    case "untilEndOfNextStep": {
      if (ctx.kind !== "event" || ctx.event.kind !== "PhaseStepEnded") return false;
      return ctx.event.payload.step === d.step;
    }
    case "asLongAs":
      // CR 611.2 — "as long as X" expires when X becomes false. The
      // registry re-checks on every event AND on epoch bumps, so state
      // changes surfaced by the layer engine (e.g., losing a type via
      // Layer 4) immediately expire the effect.
      return !evalCondition(d.condition, game);
    default: {
      const _: never = d;
      throw new Error(`isExpired: unreachable ${JSON.stringify(_)}`);
    }
  }
};

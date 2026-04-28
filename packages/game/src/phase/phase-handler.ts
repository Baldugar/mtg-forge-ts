// SPDX-License-Identifier: GPL-3.0-or-later
// PhaseHandler — generator-based turn walker. Consumes the TurnQueue and
// the PhaseSequence to drive the canonical MTG turn structure, yielding
// EngineYields (events + priority decisions) at each observable step.
//
// SP1 emission contract per turn:
//   TurnStarted
//   for each PhaseStep in PhaseSequence:
//     StepStarted
//     <turn-based actions> (Untap: untap-all; Draw: draw-one)
//     <priority decision for the active player — SP1-minimal>
//     StepEnded
//   TurnEnded
//
// SP1 priority is minimal: only the active player is asked once per step and
// the legal actions are {pass, concede}. Full priority passing between all
// seats, stack resolution, upkeep triggers, cleanup-phase discard, and
// combat damage assignment land in SP2 on top of this scaffold.
import type { DecisionRequest, DecisionResponse, PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";
import {
  GameStateIntegrityError,
  IllegalDecisionError,
  PhaseStep as Phase,
  ZoneType,
  mkEvent,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { GameAction } from "../action/game-action.js";
import { onUpkeepAdvanceInitiativeDungeon } from "../dnd/initiative-tracker.js";
import { endGame } from "../end/end-game.js";
import type { Game } from "../game.js";
import { tickSuspendedCards } from "../keyword/suspend-tick.js";
import { processPhasingOnUntap } from "../phasing/phasing-ops.js";
import { canUntap } from "../statics/wave60-cant-gates.js";
import { noteTurnEnd, tryUpkeepTransition } from "./day-night-tracker.js";
import { PhaseSequence } from "./phase-sequence.js";
import { type Turn, TurnQueue } from "./turn-queue.js";

export class PhaseHandler {
  readonly phaseSequence: PhaseSequence = new PhaseSequence();
  readonly turnQueue: TurnQueue = new TurnQueue();
  private readonly action: GameAction;

  constructor(private readonly game: Game) {
    this.action = new GameAction(game);
  }

  // Main entry: walks turns until the queue is drained or the game reaches
  // terminal state. Callers (the engine driver — SP2) iterate this
  // generator and forward events to subscribers; SP1 tests drain it
  // directly with .next() since no decision yields exist yet.
  *run(): Generator<EngineYield, void, DecisionResponse> {
    while (!this.game.isTerminal()) {
      const turn = this.turnQueue.pop();
      if (!turn) return;
      // WHY: a skip-marker pops without emitting turn-scoped events so
      // replays see the gap (turn counter does NOT advance for skips
      // either — they displace a normal turn without consuming one).
      if (turn.isSkip) continue;

      this.game.activePlayer = turn.activePlayer;
      yield* this.runTurn(turn);
      // WHY: if the turn ended mid-step via concede (or SP2 loss SBA),
      // terminalState is set. Advancing game.turn past the terminal point
      // would misrepresent the turn counter in GameEnded payloads and any
      // post-game snapshot — the game ended on the current turn, not the
      // next one.
      if (this.game.isTerminal()) return;
      this.game.turn += 1;
    }
  }

  *runTurn(turn: Turn): Generator<EngineYield, void, DecisionResponse> {
    const game = this.game;
    // SP2 Milestone H (Task 33) — route turn-boundary events through
    // game.emitEvent so ContinuousEffectRegistry.onEvent sees them and
    // can expire untilEndOfTurn / untilEndOfYourNextTurn effects.
    yield game.emitEvent(mkEvent("TurnStarted", game.turn, game.phase, { activeSeat: turn.activePlayer }));
    const steps = this.phaseSequence.getSteps();
    for (const step of steps) {
      game.phase = step;
      yield* this.runStep(step);
      if (game.isTerminal()) break;
    }
    // WHY: when the game reached terminal state mid-turn (e.g. concede in
    // a priority window), runStep already emitted GameEnded. Emitting
    // TurnEnded after that produces a zombie event — subscribers that
    // finalize on GameEnded would observe a post-terminal turn boundary.
    if (game.isTerminal()) return;
    yield game.emitEvent(mkEvent("TurnEnded", game.turn, game.phase, { activeSeat: turn.activePlayer }));
    // Task 74 — reset per-turn tracking maps/sets AFTER TurnEnded emits
    // so triggers observing TurnEnded still see the turn's data. SP3's
    // cleanup-step implementation will move these resets into the proper
    // CR 514.1 cleanup-step position.
    game.flags.countersAddedThisTurn.clear();
    game.flags.leftBattlefieldThisTurn.clear();
    game.flags.topLibsCast.clear();
    // Wave 32 — Revolt's per-controller counter resets each turn alongside
    // the existing per-turn tracking (CR-style "this turn" predicates).
    game.flags.permanentsLeftBfThisTurn.clear();
    // Wave 51 — per-turn stat trackers reset alongside the rest. Snapshot
    // cardsEnteredThisTurn → lastTurnCardsEntered FIRST so the next turn's
    // Count$LastTurnEntered selector reads the just-finished turn's value.
    game.flags.lastTurnCardsEntered.clear();
    for (const [seat, n] of game.flags.cardsEnteredThisTurn) {
      game.flags.lastTurnCardsEntered.set(seat, n);
    }
    game.flags.cardsDrawnThisTurn.clear();
    game.flags.lifeGainedThisTurn.clear();
    game.flags.lifeLostThisTurn.clear();
    game.flags.cardsEnteredThisTurn.clear();
    game.flags.attackersDeclaredThisTurn.clear();
    game.flags.surveiledThisTurn.clear();
    game.flags.flippedCoinsThisTurn.clear();
    game.flags.rolledDiceThisTurn.clear();
    game.flags.countersRemovedThisTurn = 0;
    game.flags.leftGraveyardThisTurn.clear();
    game.flags.creaturesDiedThisTurn = 0;
    // Wave 59 — Freerunning availability tracker resets at TurnEnded.
    game.flags.combatDamageDealtThisTurn.clear();
    // Wave 27 — Day/Night auto-transition support. Snapshot this turn's
    // spell-cast counts into lastTurnSpellsCast + record whose turn just
    // ended so the NEXT upkeep can apply CR 726.4 ("if it's day and the
    // previous turn's player cast 0 non-land spells, it becomes night",
    // and the symmetric night→day rule). Snapshot must happen AFTER the
    // counter resets above are computed but BEFORE the next turn begins;
    // here is the precise window.
    noteTurnEnd(game, turn.activePlayer);
    // Wave 15 — drain pending extra turns queued by AddTurnEffect during
    // this turn. CR 500.7: each takes effect before the next scheduled
    // turn. Multiple extra turns are pushed in registration order; we
    // unshift in reverse so the FIRST queued extra turn is the FIRST to
    // fire (turn-queue.pushExtra does a single unshift).
    if (game.flags.pendingExtraTurns.length > 0) {
      const pending = [...game.flags.pendingExtraTurns];
      game.flags.pendingExtraTurns.length = 0;
      for (let i = pending.length - 1; i >= 0; i--) {
        const seat = pending[i];
        if (seat === undefined) continue;
        this.turnQueue.pushExtra({ activePlayer: seat, isExtra: true });
      }
    }
  }

  *runStep(step: PhaseStep): Generator<EngineYield, void, DecisionResponse> {
    const game = this.game;
    yield {
      kind: "event",
      event: mkEvent("StepStarted", game.turn, game.phase, {
        activeSeat: game.activePlayer,
        step,
      }),
    };

    yield* this.performTurnBasedActions(step, game.activePlayer);
    if (game.isTerminal()) return;

    // SP1-minimal priority window. The active player is offered {pass,
    // concede}. SP2 will expand this to the full APNAP priority pass loop
    // with spell casts, ability activations, and stack resolution. The
    // concede branch writes terminal state via endGame and emits
    // PlayerConceded + GameEnded — the step ends abnormally, so StepEnded
    // is intentionally NOT emitted on that path.
    const request: DecisionRequest = {
      kind: "priority",
      playerSeat: game.activePlayer,
      legalActions: [{ kind: "pass" }, { kind: "concede" }],
    };
    const response: DecisionResponse = yield { kind: "decision", request };
    if (response.kind !== "priority") {
      throw new IllegalDecisionError(`PhaseHandler expected priority response, got ${response.kind}`);
    }
    if (response.action.kind === "concede") {
      const concedingSeat = game.activePlayer;
      const opponent = game.players.find((p) => p.seat !== concedingSeat);
      if (!opponent) {
        throw new GameStateIntegrityError("PhaseHandler: no opponent to win by concession");
      }
      const winningSeat = opponent.seat;
      yield {
        kind: "event",
        event: mkEvent("PlayerConceded", game.turn, game.phase, { playerSeat: concedingSeat }),
      };
      endGame(game, { kind: "win", winner: winningSeat, reason: "concession" }, [concedingSeat]);
      yield {
        kind: "event",
        event: mkEvent("GameEnded", game.turn, game.phase, {
          winners: [winningSeat],
          reason: "concede",
        }),
      };
      return;
    }
    // response.action.kind === "pass" — SP1 no-op, step ends cleanly. SP2
    // loops priority between all seats and resolves the stack before the
    // step closes.

    yield {
      kind: "event",
      event: mkEvent("StepEnded", game.turn, game.phase, {
        activeSeat: game.activePlayer,
        step,
      }),
    };
  }

  *performTurnBasedActions(
    step: PhaseStep,
    active: PlayerSeat,
  ): Generator<EngineYield, void, DecisionResponse> {
    const game = this.game;
    if (step === Phase.Upkeep) {
      // Wave 27 — Day/Night CR 726.4. At the start of each upkeep, if the
      // state is day or night, check the previous turn's controller's non-
      // land spell count and flip if the rule fires. No-op while dayNight
      // is "neither" (state is dormant until a triggering card seeds it).
      const transition = tryUpkeepTransition(game);
      if (transition !== null) {
        yield game.emitEvent({
          kind: "DayTimeChanged",
          version: 1,
          turn: game.turn,
          phase: game.phase,
          payload: { oldValue: transition.oldValue, newValue: transition.newValue },
        });
      }
      // Wave 27 — Initiative-dungeon advance (CR 906.4c). The active player,
      // if they hold the initiative, ventures one room into the Undercity.
      // Wave 45 — emit the UndercityRoomEntered pulse so triggers + UI can
      // observe; per-room SVar effects remain TODO(advanced).
      for (const evt of onUpkeepAdvanceInitiativeDungeon(game, active)) {
        yield game.emitEvent(evt);
      }
      // Wave 29 — CR 702.61b suspend tick. At the start of each player's
      // upkeep, decrement one time counter from each suspended card that
      // player owns. Cards whose counter reaches 0 are eligible for the
      // Suspend AltCost on the controller's next priority window
      // (altcost/suspend.ts). MVP: explicit cast — no auto-cast offer
      // is yielded here; the player invokes the alt-cost manually.
      tickSuspendedCards(game, active);
    }
    if (step === Phase.EndStep) {
      // Wave 27 — Monarch end-step draw (CR 716.4a). At the BEGINNING of
      // the monarch's end step, the monarch draws a card. We trigger it
      // unconditionally on EndStep — drawCards is a no-op if the seat
      // isn't the monarch (we gate here, not inside drawCards).
      if (game.flags.monarch !== null && game.flags.monarch === active) {
        yield* this.action.drawCards(active, 1);
      }
    }
    if (step === Phase.Untap) {
      // CR 702.26d — phasing turn-based action runs at the START of the
      // untap step, before untap. Permanents the active player controls
      // toggle phased state; phased-out permanents coming back in this
      // step do NOT untap this turn (CR 702.26d second sentence), which
      // the untap loop below honors implicitly since phased-in permanents
      // that were phased out last turn carry their tapped state unchanged.
      yield* processPhasingOnUntap(game, active);
      // Untap all permanents the active player controls. SP1 simplification:
      // iterate the active player's battlefield; control-change effects
      // mean SP2 will need to scan all battlefields for controllerSeat
      // matches instead.
      const player = game.getPlayer(active);
      const bf = player.zones.get(ZoneType.Battlefield);
      if (bf) {
        for (const cardId of bf.toArray()) {
          const card = game.cards.get(cardId);
          // CR 702.26e — phased-out permanents don't untap.
          if (card?.phased === true) continue;
          // Wave 60 — DontUntap gate (Stasis-style "permanents don't
          // untap during their controller's untap step"). Skip the
          // matching card entirely; no untap, no event.
          if (!canUntap(game, cardId)) continue;
          if (card?.tapped) {
            yield* this.action.untap(cardId);
          }
        }
      }
    } else if (step === Phase.Draw) {
      // Active player draws one, unless this is turn 1 and rules say the
      // first player skips their draw (standard 2-player rule). "First
      // player" is whichever seat won the setup die-roll — game.startingPlayer
      // — NOT hard-coded to seat 0; otherwise games where seat 1 went first
      // would have seat 0 incorrectly skip its first Draw.
      const firstSeat = game.startingPlayer;
      const shouldSkip =
        game.turn === 1 && game.rules.firstPlayerSkipsDraw && firstSeat !== null && active === firstSeat;
      // WHY: the flag is authoritative ("undefined means false" would
      // make snapshot round-trips ambiguous). Write it explicitly on
      // every turn-1 Draw step so every seat has a definitive record.
      if (game.turn === 1) {
        game.flags.firstTurnDrawSkipped.set(active, shouldSkip);
      }
      if (!shouldSkip) {
        yield* this.action.drawCards(active, 1);
      }
    }
    // SP2: Upkeep (triggered-ability harvest), Cleanup (discard-to-max,
    // damage wipe, "until end of turn" cleanup), Combat steps (TBAs for
    // attacker/blocker assignment) layer here without changing the outer
    // runStep contract.
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// PhaseHandler — generator-based turn walker. Consumes the TurnQueue and
// the PhaseSequence to drive the canonical MTG turn structure, yielding
// EngineYields (events today, decisions in SP2) at each observable step.
//
// SP1 emission contract per turn:
//   TurnStarted
//   for each PhaseStep in PhaseSequence:
//     StepStarted
//     <turn-based actions> (Untap: untap-all; Draw: draw-one)
//     StepEnded
//   TurnEnded
//
// SP1 does NOT yield priority decisions — the integration smoke test for
// Task 49 runs with no spells or activated abilities, so the priority-pass
// loop is postponed to SP2 along with stack resolution, upkeep triggers,
// cleanup-phase discard, and combat damage assignment.
import type { DecisionResponse, PhaseStep, PlayerSeat } from "@mtg-forge-ts/core";
import { PhaseStep as Phase, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { GameAction } from "../action/game-action.js";
import type { Game } from "../game.js";
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
      this.game.turn += 1;
    }
  }

  *runTurn(turn: Turn): Generator<EngineYield, void, DecisionResponse> {
    const game = this.game;
    yield {
      kind: "event",
      event: mkEvent("TurnStarted", game.turn, game.phase, { activeSeat: turn.activePlayer }),
    };
    const steps = this.phaseSequence.getSteps();
    for (const step of steps) {
      game.phase = step;
      yield* this.runStep(step);
      if (game.isTerminal()) break;
    }
    yield {
      kind: "event",
      event: mkEvent("TurnEnded", game.turn, game.phase, { activeSeat: turn.activePlayer }),
    };
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

    // TODO SP2: priority passes + stack-resolution loop between turn-based
    // actions and step end. SP1 intentionally omits decisions; Task 49's
    // integration smoke test runs without spell casts or ability
    // activations.

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
    if (step === Phase.Untap) {
      // Untap all permanents the active player controls. SP1 simplification:
      // iterate the active player's battlefield; control-change effects
      // mean SP2 will need to scan all battlefields for controllerSeat
      // matches instead.
      const player = game.getPlayer(active);
      const bf = player.zones.get(ZoneType.Battlefield);
      if (bf) {
        for (const cardId of bf.toArray()) {
          const card = game.cards.get(cardId);
          if (card?.tapped) {
            yield* this.action.untap(cardId);
          }
        }
      }
    } else if (step === Phase.Draw) {
      // Active player draws one, unless this is turn 1 and rules say the
      // first player skips their draw (standard 2-player rule).
      const firstSeat = game.players[0]?.seat;
      const shouldSkip =
        game.turn === 1 && game.rules.firstPlayerSkipsDraw && firstSeat !== undefined && active === firstSeat;
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

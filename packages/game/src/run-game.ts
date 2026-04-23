// SPDX-License-Identifier: GPL-3.0-or-later
// runGame — top-level suspendable game driver. Composes setupGame with a
// PhaseHandler, returning a single Generator<EngineYield, void, DecisionResponse>
// that callers (the integration smoke test, CLI drivers in SP2+, eventual
// UI bindings) can drive by feeding DecisionResponses for every decision
// yield and forwarding GameEvents to subscribers.
//
// SP1 turn-queue seeding: if the caller has not pre-populated the queue,
// we enqueue one turn per seat in seat order. This is enough for Task 49's
// smoke test (seat 0 concedes on the first priority window) and for any
// scripted replay that specifies its own turn count via rounds of seeding.
// SP2 will replace this with a proper per-round scheduler driven by
// TurnEnded events.
import type { DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "./action/engine-yield.js";
import type { Game } from "./game.js";
import { PhaseHandler } from "./phase/phase-handler.js";
import type { CommanderAssignment, SetupDecks } from "./setup/setup-flow.js";
import { setupGame } from "./setup/setup-flow.js";

export interface RunGameOptions {
  readonly decks: SetupDecks;
  /**
   * Optional per-seat commander assignment. Omit for non-Commander formats.
   * Passed straight through to setupGame (SP1 §6.4 + §6.6).
   */
  readonly commanders?: { readonly [seat: number]: CommanderAssignment };
}

export function* runGame(game: Game, opts: RunGameOptions): Generator<EngineYield, void, DecisionResponse> {
  yield* setupGame(game, { decks: opts.decks, ...(opts.commanders ? { commanders: opts.commanders } : {}) });
  if (game.isTerminal()) return;

  const phaseHandler = new PhaseHandler(game);
  if (phaseHandler.turnQueue.length === 0) {
    for (const player of game.players) {
      phaseHandler.turnQueue.push({ activePlayer: player.seat, isExtra: false });
    }
  }
  yield* phaseHandler.run();
}

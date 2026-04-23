// SPDX-License-Identifier: GPL-3.0-or-later
// Integration smoke test for the SP1 engine. Constructs a two-player Game,
// seeds 60 stub Cards per library directly in Game.cards (CardDb + factory
// land in SP4), runs it through setupGame + PhaseHandler.run via runGame,
// and drives the generator with ScriptedControllers that keep their opening
// hand and then concede on the very first priority window. The test asserts:
//   - the game reaches terminal state with the non-conceding seat as winner;
//   - the event stream contains GameStarted, TurnStarted, PlayerConceded,
//     and GameEnded;
//   - the generator exits cleanly (no infinite priority loop).
import type {
  DecisionRequest,
  DecisionResponse,
  EntityId,
  GameEvent,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { PlayerController } from "../../src/controller/controller.js";
import { ScriptedController } from "../../src/controller/scripted-controller.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { runGame } from "../../src/run-game.js";
import type { SetupDecks } from "../../src/setup/setup-flow.js";

// SP1 stub: runGame only needs Card instances in game.cards keyed by
// EntityId plus a PaperCard payload shaped like the inventory type. SP4
// swaps this for CardDb-backed construction.
const stubPaperCard = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const rules: GameRules = {
  formatId: "casual",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2026-03-17",
  seed: "0x1234",
};

describe("scripted no-op game (integration smoke)", () => {
  it("runs to terminal state when seat 0 concedes on first priority", () => {
    const game = new Game({
      lobbyPlayers: [
        { id: "p0", name: "P0", controllerKind: "scripted" },
        { id: "p1", name: "P1", controllerKind: "scripted" },
      ],
      rules,
      meta,
      rng: new SeededRng(0x1234n),
    });

    // Seed 60 placeholder cards per player into game.cards; setupGame copies
    // them into the Library zone and draws the opening hand. Keeping this
    // inline keeps the test readable — an SP4-era helper would centralise it.
    const decks: Record<number, EntityId[]> = { 0: [], 1: [] };
    for (let seat = 0; seat < 2; seat++) {
      const playerSeat = mkPlayerSeat(seat);
      for (let i = 0; i < 60; i++) {
        const id = game.newEntityId();
        game.cards.set(
          id,
          new Card(id, stubPaperCard(`Stub ${seat}-${i}`), playerSeat, playerSeat, ZoneType.Library),
        );
        const deck = decks[seat];
        if (!deck) throw new Error("test: unreachable — deck bucket missing");
        deck.push(id);
      }
    }

    const controllers = new Map<PlayerSeat, PlayerController>([
      [
        mkPlayerSeat(0),
        new ScriptedController([
          { kind: "mulligan", keep: true },
          { kind: "priority", action: { kind: "concede" } },
        ]),
      ],
      [mkPlayerSeat(1), new ScriptedController([{ kind: "mulligan", keep: true }])],
    ]);

    const events: GameEvent[] = [];
    const gen = runGame(game, { decks: decks as unknown as SetupDecks });
    let step = gen.next();
    let safety = 0;
    while (!step.done) {
      safety++;
      if (safety > 10000) throw new Error("runaway generator — expected concede to end the game");
      if (step.value.kind === "decision") {
        const request: DecisionRequest = step.value.request;
        // Every SP1 DecisionRequest variant that reaches this test carries a
        // playerSeat; narrow on presence instead of listing every kind.
        if (!("playerSeat" in request)) {
          throw new Error(`integration test: unexpected request kind ${request.kind}`);
        }
        const seat: PlayerSeat = request.playerSeat;
        const controller = controllers.get(seat);
        if (!controller)
          throw new Error(`integration test: no controller for seat ${seat as unknown as number}`);
        const response: DecisionResponse = controller.decide(request);
        step = gen.next(response);
      } else {
        events.push(step.value.event);
        step = gen.next();
      }
    }

    expect(game.isTerminal()).toBe(true);
    expect(game.terminalState?.outcome.kind).toBe("win");
    if (game.terminalState?.outcome.kind === "win") {
      expect(game.terminalState.outcome.winner).toBe(mkPlayerSeat(1));
      expect(game.terminalState.outcome.reason).toBe("concession");
    }
    expect(game.terminalState?.concededSeats).toEqual([mkPlayerSeat(0)]);

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("GameStarted");
    expect(kinds).toContain("TurnStarted");
    expect(kinds).toContain("PlayerConceded");
    expect(kinds).toContain("GameEnded");

    const gameEnded = events.find((e) => e.kind === "GameEnded");
    if (gameEnded?.kind === "GameEnded") {
      expect(gameEnded.payload.winners).toEqual([mkPlayerSeat(1)]);
      expect(gameEnded.payload.reason).toBe("concede");
    } else {
      throw new Error("expected GameEnded event in stream");
    }
  });
});

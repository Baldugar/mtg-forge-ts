// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { PhaseStep, SeededRng, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { TerminalOutcome } from "../terminal-state.js";
import { endGame } from "./end-game.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });

describe("endGame", () => {
  it("writes terminalState with a win outcome and makes Game.isTerminal() true", () => {
    const game = mkGame();
    expect(game.isTerminal()).toBe(false);
    const outcome: TerminalOutcome = {
      kind: "win",
      winner: mkPlayerSeat(0),
      reason: "opponent has 0 life",
    };
    endGame(game, outcome);
    expect(game.isTerminal()).toBe(true);
    expect(game.terminalState?.outcome).toEqual(outcome);
    expect(game.terminalState?.endedAt).toEqual({ turn: game.turn, phase: game.phase });
    expect(game.terminalState?.concededSeats).toEqual([]);
  });

  it("round-trips a teamWin outcome", () => {
    const game = mkGame();
    const outcome: TerminalOutcome = { kind: "teamWin", teamId: 2, reason: "sole surviving team" };
    endGame(game, outcome);
    expect(game.terminalState?.outcome).toEqual(outcome);
  });

  it("round-trips a draw outcome", () => {
    const game = mkGame();
    const outcome: TerminalOutcome = { kind: "draw", reason: "simultaneous loss" };
    endGame(game, outcome);
    expect(game.terminalState?.outcome.kind).toBe("draw");
  });

  it("records concededSeats and defensively copies the input", () => {
    const game = mkGame();
    const seats = [mkPlayerSeat(0), mkPlayerSeat(1)];
    endGame(game, { kind: "draw", reason: "mutual concede" }, seats);
    expect(game.terminalState?.concededSeats).toEqual(seats);
    // WHY: defensive copy means mutating the caller-held array doesn't
    // leak into terminalState.
    seats.push(mkPlayerSeat(5));
    expect(game.terminalState?.concededSeats).toHaveLength(2);
  });

  it("captures the turn and phase at end time", () => {
    const game = mkGame();
    game.turn = 7;
    game.phase = PhaseStep.EndStep;
    endGame(game, { kind: "win", winner: mkPlayerSeat(0), reason: "lethal" });
    expect(game.terminalState?.endedAt).toEqual({ turn: 7, phase: PhaseStep.EndStep });
  });

  it("throws on double-assignment", () => {
    const game = mkGame();
    endGame(game, { kind: "draw", reason: "first" });
    expect(() => endGame(game, { kind: "win", winner: mkPlayerSeat(0), reason: "second" })).toThrow(
      /already in terminal state/,
    );
  });

  it("a fresh Game has terminalState null and isTerminal false", () => {
    const game = mkGame();
    expect(game.terminalState).toBeNull();
    expect(game.isTerminal()).toBe(false);
  });
});

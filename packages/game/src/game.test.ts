// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, PhaseStep, SeededRng, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const standardRules: GameRules = {
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

const makeGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules: standardRules,
    meta,
    rng: new SeededRng(1n),
  });

describe("Game", () => {
  it("constructs with two lobby players, producing two Players with seats 0 and 1", () => {
    const g = makeGame();
    expect(g.players).toHaveLength(2);
    expect(g.players[0]?.seat).toBe(mkPlayerSeat(0));
    expect(g.players[1]?.seat).toBe(mkPlayerSeat(1));
    expect(g.players[0]?.lobbyPlayer).toBe(alice);
    expect(g.players[1]?.lobbyPlayer).toBe(bob);
  });

  it("initial turn/phase/activePlayer state is correct", () => {
    const g = makeGame();
    expect(g.turn).toBe(1);
    expect(g.phase).toBe(PhaseStep.Untap);
    expect(g.activePlayer).toBe(mkPlayerSeat(0));
    expect(g.priorityPlayer).toBeNull();
  });

  it("sharedZones contains Exile + Ante + empty Stack", () => {
    const g = makeGame();
    expect(g.sharedZones.exile.size).toBe(0);
    expect(g.sharedZones.ante.size).toBe(0);
    expect(g.sharedZones.stack.size).toBe(0);
  });

  it("flags are initialized to defaults (dayNight 'neither', empty maps/sets)", () => {
    const g = makeGame();
    expect(g.flags.dayNight).toBe("neither");
    expect(g.flags.monarch).toBeNull();
    expect(g.flags.initiative).toBeNull();
    expect(g.flags.cityBlessing.size).toBe(0);
    expect(g.flags.ringBearer.size).toBe(0);
    expect(g.flags.turnsTakenThisTurn).toBe(0);
    expect(g.flags.skippedPhases).toEqual([]);
    expect(g.flags.activeTeamForTeamPlay).toBeNull();
    expect(g.flags.stickers).toEqual([]);
  });

  it("getPlayer returns the player at the given seat", () => {
    const g = makeGame();
    const p0 = g.getPlayer(mkPlayerSeat(0));
    expect(p0.lobbyPlayer).toBe(alice);
    const p1 = g.getPlayer(mkPlayerSeat(1));
    expect(p1.lobbyPlayer).toBe(bob);
  });

  it("getPlayer throws GameStateIntegrityError for unknown seat", () => {
    const g = makeGame();
    expect(() => g.getPlayer(mkPlayerSeat(5))).toThrow(GameStateIntegrityError);
  });

  it("isTerminal returns false initially; true after terminalState set", () => {
    const g = makeGame();
    expect(g.isTerminal()).toBe(false);
    g.terminalState = {
      endedAt: { turn: 7, phase: g.phase },
      outcome: { kind: "win", winner: mkPlayerSeat(0), reason: "victory" },
      concededSeats: [],
    };
    expect(g.isTerminal()).toBe(true);
  });

  it("newEntityId returns unique incrementing EntityIds starting at 0", () => {
    const g = makeGame();
    const a = g.newEntityId();
    const b = g.newEntityId();
    const c = g.newEntityId();
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(c).toBe(2);
  });

  it("default teamId assignment: each seat is its own team when teamAssignments omitted", () => {
    const g = makeGame();
    expect(g.players[0]?.teamId).toBe(0);
    expect(g.players[1]?.teamId).toBe(1);
  });

  it("teamAssignments from rules overrides default per-seat team", () => {
    const g = new Game({
      lobbyPlayers: [alice, bob],
      rules: { ...standardRules, teamAssignments: [0, 0] },
      meta,
      rng: new SeededRng(1n),
    });
    expect(g.players[0]?.teamId).toBe(0);
    expect(g.players[1]?.teamId).toBe(0);
  });

  it("throws GameStateIntegrityError when lobbyPlayers.length < rules.playerCount.min", () => {
    expect(
      () =>
        new Game({
          lobbyPlayers: [alice],
          rules: standardRules,
          meta,
          rng: new SeededRng(1n),
        }),
    ).toThrow(GameStateIntegrityError);
  });

  it("throws GameStateIntegrityError when lobbyPlayers.length > rules.playerCount.max", () => {
    const charlie: LobbyPlayer = { id: "p-charlie", name: "Charlie", controllerKind: "ai" };
    expect(
      () =>
        new Game({
          lobbyPlayers: [alice, bob, charlie],
          rules: standardRules,
          meta,
          rng: new SeededRng(1n),
        }),
    ).toThrow(GameStateIntegrityError);
  });

  it("attachCardDb throws with SP4 CardDb message", () => {
    const g = makeGame();
    expect(() => g.attachCardDb({})).toThrow(/SP4 CardDb/);
  });

  it("rng is retained as-provided for deterministic replay", () => {
    const rng = new SeededRng(42n);
    const g = new Game({ lobbyPlayers: [alice, bob], rules: standardRules, meta, rng });
    expect(g.rng).toBe(rng);
  });

  it("applies GameRules.startingLife to every Player (default 20)", () => {
    const g = makeGame();
    expect(g.players[0]?.life).toBe(20);
    expect(g.players[1]?.life).toBe(20);
  });

  it("applies non-default startingLife (e.g. Commander-style 40) from rules", () => {
    const g = new Game({
      lobbyPlayers: [alice, bob],
      rules: { ...standardRules, startingLife: 40 },
      meta,
      rng: new SeededRng(1n),
    });
    expect(g.players[0]?.life).toBe(40);
    expect(g.players[1]?.life).toBe(40);
  });
});

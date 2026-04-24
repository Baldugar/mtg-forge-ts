// SPDX-License-Identifier: GPL-3.0-or-later
// Team-combat (Two-Headed Giant) state slot — SP2 Task 51 minimal wiring.
// The game.teamLife map is populated when the variant is applied; a helper
// surface (getTeamLifeFor) lets SP6/format-specific damage routing read
// the shared pool. Full damage routing (player damage → shared life) is
// deferred to SP6 per master-spec §10.teams.
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const carol: LobbyPlayer = { id: "p-carol", name: "Carol", controllerKind: "human" };
const dave: LobbyPlayer = { id: "p-dave", name: "Dave", controllerKind: "ai" };

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkRules = (appliedVariants: string[], teamAssignments?: number[]): GameRules => ({
  formatId: "standard",
  startingLife: 30,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 4 },
  poisonCountersToLose: 15,
  playForAnte: false,
  manaBurn: false,
  ...(teamAssignments !== undefined ? { teamAssignments } : {}),
  appliedVariants: appliedVariants as GameRules["appliedVariants"],
});

describe("Game team-life pool (Task 51)", () => {
  it("non-2HG games have teamLife = null", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules: mkRules([]),
      meta,
      rng: new SeededRng(1n),
    });
    expect(game.teamLife).toBeNull();
  });

  it("2HG with explicit teamAssignments populates per-team pools", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob, carol, dave],
      rules: mkRules(["TwoHeadedGiant"], [0, 0, 1, 1]),
      meta,
      rng: new SeededRng(1n),
    });
    expect(game.teamLife).not.toBeNull();
    expect(game.teamLife?.size).toBe(2);
    expect(game.teamLife?.get(0)).toBe(30);
    expect(game.teamLife?.get(1)).toBe(30);
  });

  it("getTeamLifeFor returns the team's shared life for a seat", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob, carol, dave],
      rules: mkRules(["TwoHeadedGiant"], [0, 0, 1, 1]),
      meta,
      rng: new SeededRng(1n),
    });
    expect(game.getTeamLifeFor(mkPlayerSeat(0))).toBe(30);
    expect(game.getTeamLifeFor(mkPlayerSeat(1))).toBe(30);
    expect(game.getTeamLifeFor(mkPlayerSeat(2))).toBe(30);
    expect(game.getTeamLifeFor(mkPlayerSeat(3))).toBe(30);
  });

  it("getTeamLifeFor returns null in non-2HG games", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules: mkRules([]),
      meta,
      rng: new SeededRng(1n),
    });
    expect(game.getTeamLifeFor(mkPlayerSeat(0))).toBeNull();
  });

  it("2HG without teamAssignments → each seat is its own team (FFA fallback)", () => {
    // Per master-spec, when teamAssignments is omitted, teamId defaults
    // to seat index. In a 2-player 2HG setup this still produces two
    // single-player teams; the variant flag alone doesn't imply pairing.
    // Real 2HG pods must supply teamAssignments.
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules: mkRules(["TwoHeadedGiant"]),
      meta,
      rng: new SeededRng(1n),
    });
    expect(game.teamLife?.size).toBe(2);
    expect(game.teamLife?.get(0)).toBe(30);
    expect(game.teamLife?.get(1)).toBe(30);
  });

  it("team-life pool is independently mutable per team (SP6 routing seed)", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob, carol, dave],
      rules: mkRules(["TwoHeadedGiant"], [0, 0, 1, 1]),
      meta,
      rng: new SeededRng(1n),
    });
    // SP6 damage-routing will write into this map; confirm we can.
    game.teamLife?.set(0, 25);
    expect(game.getTeamLifeFor(mkPlayerSeat(0))).toBe(25);
    // Team 1 untouched.
    expect(game.getTeamLifeFor(mkPlayerSeat(2))).toBe(30);
  });
});

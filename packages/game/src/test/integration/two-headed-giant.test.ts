// SPDX-License-Identifier: GPL-3.0-or-later
// M7.13e — Two-Headed Giant variant integration (CR 810). MVP scope: a
// 4-seat / 2-team game with a shared per-team life pool, a 15-poison
// team-loss threshold, and life mirroring across teammates so every
// per-player life reader (loss conditions, SBA, life triggers) observes
// the team total. Full turn-merging (CR 810.7 — paired seats take their
// turn together) is deferred to SP6 per the TODO at the top of
// setup-flow.ts; the engine still plays as 4 individual seats whose two
// pairs share a life total + poison threshold.
//
// Verified:
//   1. setupGame with 4 seats, an applied "TwoHeadedGiant" variant, and
//      an explicit teams mapping populates game.teamLife with two teams
//      at 30 life apiece, mirrors that life onto every Player.life, and
//      stamps the right teamId per player.
//   2. damage to one teammate decrements the team-life pool AND mirrors
//      the new total onto the other teammate's Player.life (so the
//      shared-life invariant holds against any per-player life reader).
//   3. the 15-poison team-loss SBA fires for both members of a team
//      whose accumulated poison crosses 15, even when no individual
//      teammate has 15 alone (CR 810.6b aggregation).
//   4. life gain on one teammate raises the team total + mirrors back.
//   5. a non-2HG game keeps teamLife null (no aggregation regression).
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { type SetupDecks, type TeamAssignment, setupGame } from "../../setup/setup-flow.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const carol: LobbyPlayer = { id: "p-carol", name: "Carol", controllerKind: "human" };
const dave: LobbyPlayer = { id: "p-dave", name: "Dave", controllerKind: "ai" };

// 2HG rules: 30 life, 15 poison, 4 seats min/max, variant flag set.
const rules2HG: GameRules = {
  formatId: "two-headed-giant",
  startingLife: 30,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 4, max: 4 },
  teamAssignments: [0, 0, 1, 1],
  poisonCountersToLose: 15,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: ["TwoHeadedGiant"],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const filler: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (rules: GameRules = rules2HG, seed = 1n): Game =>
  new Game({
    lobbyPlayers: [alice, bob, carol, dave],
    rules,
    meta,
    rng: new SeededRng(seed),
  });

// Library cards for every seat — setupGame requires libraries be seeded.
const seedLibrary = (game: Game, seat: PlayerSeat, count: number, startId: number): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    game.cards.set(id, new Card(id, filler, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

// Drive setupGame to completion with default keep-first-hand answers.
const driveSetup = (game: Game, decks: SetupDecks, teams: readonly TeamAssignment[]): GameEvent[] => {
  const gen = setupGame(game, { decks, teams });
  const events: GameEvent[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      events.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.request.kind === "mulligan") {
      const resp: DecisionResponse = { kind: "mulligan", keep: true };
      step = gen.next(resp);
    } else if (y.request.kind === "mulliganBottom") {
      const resp: DecisionResponse = {
        kind: "mulliganBottom",
        bottomed: y.request.hand.slice(0, y.request.countToBottom),
      };
      step = gen.next(resp);
    } else if (y.request.kind === "companionDeclaration") {
      const resp: DecisionResponse = { kind: "companionDeclaration", companionId: null };
      step = gen.next(resp);
    } else if (y.request.kind === "openingHandAction") {
      const resp: DecisionResponse = { kind: "openingHandAction", chosenActions: [] };
      step = gen.next(resp);
    } else {
      throw new Error(`drive: unexpected decision kind ${y.request.kind}`);
    }
  }
  return events;
};

const seedAllLibraries = (game: Game): SetupDecks => {
  const decks: { [seat: number]: EntityId[] } = {};
  for (let i = 0; i < 4; i++) {
    decks[i] = seedLibrary(game, mkPlayerSeat(i), 30, i * 1000);
  }
  return decks as SetupDecks;
};

const drainGenerator = <T>(gen: Generator<EngineYield, T, unknown>): EngineYield[] => {
  const ys: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    ys.push(step.value);
    step = gen.next();
  }
  return ys;
};

const countEvents = (ys: EngineYield[], kind: string): number =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind).length;

describe("M7.13e — Two-Headed Giant variant (CR 810)", () => {
  it("setupGame populates teamLife (2 teams × 30 life) and mirrors life onto every Player.life", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];
    driveSetup(game, decks, teams);

    // Two teams, each at 30 life.
    expect(game.teamLife).not.toBeNull();
    expect(game.teamLife?.size).toBe(2);
    expect(game.teamLife?.get(0)).toBe(30);
    expect(game.teamLife?.get(1)).toBe(30);

    // Every Player.life mirrors the team total (30 across the board).
    for (const player of game.players) {
      expect(player.life).toBe(30);
    }
    // teamId stamping reflects the supplied teams mapping.
    expect(game.players[0]?.teamId).toBe(0);
    expect(game.players[1]?.teamId).toBe(0);
    expect(game.players[2]?.teamId).toBe(1);
    expect(game.players[3]?.teamId).toBe(1);

    // getTeamLifeFor agrees per-seat.
    expect(game.getTeamLifeFor(mkPlayerSeat(0))).toBe(30);
    expect(game.getTeamLifeFor(mkPlayerSeat(1))).toBe(30);
    expect(game.getTeamLifeFor(mkPlayerSeat(2))).toBe(30);
    expect(game.getTeamLifeFor(mkPlayerSeat(3))).toBe(30);
  });

  it("damage to one teammate (life loss) decrements team life and mirrors onto the other teammate", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];
    driveSetup(game, decks, teams);

    // Alice (seat 0, team 0) loses 5 life. Both team 0 members fall to 25;
    // team 1 stays at 30.
    drainGenerator(game.action.changeLife(mkPlayerSeat(0), -5, { cause: "damage" }));

    expect(game.teamLife?.get(0)).toBe(25);
    expect(game.teamLife?.get(1)).toBe(30);
    expect(game.players[0]?.life).toBe(25);
    expect(game.players[1]?.life).toBe(25);
    expect(game.players[2]?.life).toBe(30);
    expect(game.players[3]?.life).toBe(30);

    // Bob (seat 1) absorbs another 4 — team 0 falls to 21, team 1 still 30.
    drainGenerator(game.action.changeLife(mkPlayerSeat(1), -4, { cause: "damage" }));
    expect(game.teamLife?.get(0)).toBe(21);
    expect(game.players[0]?.life).toBe(21);
    expect(game.players[1]?.life).toBe(21);
    expect(game.players[2]?.life).toBe(30);
    expect(game.players[3]?.life).toBe(30);
  });

  it("life gain on one teammate raises the team total and mirrors back", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];
    driveSetup(game, decks, teams);

    // Carol (seat 2, team 1) gains 7 life — both team 1 members rise to 37.
    drainGenerator(game.action.changeLife(mkPlayerSeat(2), 7, { cause: "effect" }));

    expect(game.teamLife?.get(1)).toBe(37);
    expect(game.teamLife?.get(0)).toBe(30);
    expect(game.players[2]?.life).toBe(37);
    expect(game.players[3]?.life).toBe(37);
    expect(game.players[0]?.life).toBe(30);
    expect(game.players[1]?.life).toBe(30);
  });

  it("team poison aggregation: both teammates lose when team poison ≥ 15 (CR 810.6b)", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];
    driveSetup(game, decks, teams);

    // Spread 8 + 7 across team 0 (totals 15 — over the threshold). Neither
    // teammate has 15 individually; aggregation is required for the loss.
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 8);
    game.getPlayer(mkPlayerSeat(1)).counters.set(CounterType.Poison, 7);
    // Team 1 stays under (5 + 5 = 10).
    game.getPlayer(mkPlayerSeat(2)).counters.set(CounterType.Poison, 5);
    game.getPlayer(mkPlayerSeat(3)).counters.set(CounterType.Poison, 5);

    const ys = drainGenerator(game.sbaEngine.sweep());
    // Both Alice + Bob get a PlayerLost (one per teammate); team 1 keeps
    // playing.
    expect(countEvents(ys, "PlayerLost")).toBe(2);
    expect(game.players[0]?.hasLost).toBe(true);
    expect(game.players[1]?.hasLost).toBe(true);
    expect(game.players[2]?.hasLost).toBe(false);
    expect(game.players[3]?.hasLost).toBe(false);
  });

  it("team poison stays sub-threshold: nobody loses when each team's total < 15", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];
    driveSetup(game, decks, teams);

    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 7);
    game.getPlayer(mkPlayerSeat(1)).counters.set(CounterType.Poison, 7);
    game.getPlayer(mkPlayerSeat(2)).counters.set(CounterType.Poison, 7);
    game.getPlayer(mkPlayerSeat(3)).counters.set(CounterType.Poison, 7);

    const ys = drainGenerator(game.sbaEngine.sweep());
    expect(countEvents(ys, "PlayerLost")).toBe(0);
    for (const player of game.players) expect(player.hasLost).toBe(false);
  });

  it("non-2HG (FFA) game keeps teamLife null and uses per-player poison threshold (no aggregation regression)", () => {
    // Strip teamAssignments via destructuring — exactOptionalPropertyTypes
    // rejects an explicit `: undefined`, but omitting the key entirely is
    // the same observable shape (Game ctor falls back to seat-as-teamId).
    const { teamAssignments: _ta, ...rest2HG } = rules2HG;
    void _ta;
    const ffaRules: GameRules = {
      ...rest2HG,
      appliedVariants: [],
      poisonCountersToLose: 10,
    };
    const game = new Game({
      lobbyPlayers: [alice, bob, carol, dave],
      rules: ffaRules,
      meta,
      rng: new SeededRng(1n),
    });
    const decks = seedAllLibraries(game);
    // Drive setup without a teams mapping — FFA each-seat-its-own-team.
    const gen = setupGame(game, { decks });
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event") {
        step = gen.next();
        continue;
      }
      if (y.request.kind === "mulligan") step = gen.next({ kind: "mulligan", keep: true });
      else if (y.request.kind === "mulliganBottom")
        step = gen.next({
          kind: "mulliganBottom",
          bottomed: y.request.hand.slice(0, y.request.countToBottom),
        });
      else if (y.request.kind === "companionDeclaration")
        step = gen.next({ kind: "companionDeclaration", companionId: null });
      else if (y.request.kind === "openingHandAction")
        step = gen.next({ kind: "openingHandAction", chosenActions: [] });
      else throw new Error(`unexpected ${y.request.kind}`);
    }

    expect(game.teamLife).toBeNull();
    // 8 + 8 across two FFA seats — no team aggregation, so neither hits
    // the 10-poison individual threshold and neither loses.
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 8);
    game.getPlayer(mkPlayerSeat(1)).counters.set(CounterType.Poison, 8);
    const ys = drainGenerator(game.sbaEngine.sweep());
    expect(countEvents(ys, "PlayerLost")).toBe(0);
  });

  it("rejects a teams mapping that omits a seat", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      // seat 3 missing — only seat 2 listed for team 1.
      { teamId: 1, seats: [mkPlayerSeat(2)] },
    ];
    expect(() => driveSetup(game, decks, teams)).toThrowError(/not assigned to any team/);
  });

  it("rejects a teams mapping that double-books a seat", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(1), mkPlayerSeat(2)] }, // seat 1 twice
    ];
    expect(() => driveSetup(game, decks, teams)).toThrowError(/listed in more than one team/);
  });

  it("per-team startingLife override is honored (e.g. asymmetric pods)", () => {
    const game = mkGame();
    const decks = seedAllLibraries(game);
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)], startingLife: 25 },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)], startingLife: 40 },
    ];
    driveSetup(game, decks, teams);

    expect(game.teamLife?.get(0)).toBe(25);
    expect(game.teamLife?.get(1)).toBe(40);
    expect(game.players[0]?.life).toBe(25);
    expect(game.players[1]?.life).toBe(25);
    expect(game.players[2]?.life).toBe(40);
    expect(game.players[3]?.life).toBe(40);
  });
});

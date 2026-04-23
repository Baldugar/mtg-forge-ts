// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  DecisionResponse,
  Deck,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
  SeededRng,
  ZoneType,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { PlayerController } from "../controller/controller.js";
import { ScriptedController } from "../controller/scripted-controller.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { runMatch } from "../run-match.js";
import type { SetupDecks } from "../setup/setup-flow.js";
import type { MatchGameFactory, MatchGameResult, MatchOptions } from "./match.js";
import { Match } from "./match.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const charlie: LobbyPlayer = { id: "p-charlie", name: "Charlie", controllerKind: "ai" };

const emptyDeck = (name: string): Deck => ({
  name,
  main: [],
  sideboard: [],
  commanderSlot: { kind: "none" },
});

const mkOptions = (bestOf: 1 | 3 | 5): MatchOptions => ({
  bestOf,
  players: [alice, bob],
  decks: [emptyDeck("Alice"), emptyDeck("Bob")],
  formatId: "standard",
});

const winForSeat = (seat: number, gameIndex: number): MatchGameResult => ({
  gameIndex,
  winners: [mkPlayerSeat(seat)],
  reason: "victory",
});

describe("Match", () => {
  it("constructs with default 0/0/false scores for every seat", () => {
    const m = new Match(mkOptions(3));
    expect(m.getScore(mkPlayerSeat(0))).toEqual({ wins: 0, gamesPlayed: 0, concededLastGame: false });
    expect(m.getScore(mkPlayerSeat(1))).toEqual({ wins: 0, gamesPlayed: 0, concededLastGame: false });
    expect(m.getGames()).toEqual([]);
    expect(m.getCurrentGame()).toBeNull();
  });

  it("Bo1: one win decides the match", () => {
    const m = new Match(mkOptions(1));
    expect(m.isDecided()).toBe(false);
    m.recordGameResult(winForSeat(0, 0));
    expect(m.getScore(mkPlayerSeat(0)).wins).toBe(1);
    expect(m.getScore(mkPlayerSeat(0)).gamesPlayed).toBe(1);
    expect(m.getScore(mkPlayerSeat(1)).wins).toBe(0);
    expect(m.getScore(mkPlayerSeat(1)).gamesPlayed).toBe(1);
    expect(m.isDecided()).toBe(true);
  });

  it("Bo3: two wins for one seat decide the match", () => {
    const m = new Match(mkOptions(3));
    m.recordGameResult(winForSeat(0, 0));
    expect(m.isDecided()).toBe(false);
    m.recordGameResult(winForSeat(0, 1));
    expect(m.getScore(mkPlayerSeat(0)).wins).toBe(2);
    expect(m.isDecided()).toBe(true);
  });

  it("Bo3: 1-1 split is not decided, needs a third game", () => {
    const m = new Match(mkOptions(3));
    m.recordGameResult(winForSeat(0, 0));
    m.recordGameResult(winForSeat(1, 1));
    expect(m.getScore(mkPlayerSeat(0)).wins).toBe(1);
    expect(m.getScore(mkPlayerSeat(1)).wins).toBe(1);
    expect(m.isDecided()).toBe(false);
    expect(m.getGames()).toHaveLength(2);
  });

  it("Bo5: first to 3 wins decides; 2-2 is still undecided", () => {
    const m = new Match(mkOptions(5));
    m.recordGameResult(winForSeat(0, 0));
    m.recordGameResult(winForSeat(1, 1));
    m.recordGameResult(winForSeat(0, 2));
    m.recordGameResult(winForSeat(1, 3));
    expect(m.isDecided()).toBe(false);
    m.recordGameResult(winForSeat(0, 4));
    expect(m.getScore(mkPlayerSeat(0)).wins).toBe(3);
    expect(m.isDecided()).toBe(true);
  });

  it("isDecided becomes true when all games played (draws/ties safety net)", () => {
    const m = new Match(mkOptions(3));
    const draw: MatchGameResult = { gameIndex: 0, winners: [], reason: "draw" };
    m.recordGameResult(draw);
    m.recordGameResult({ gameIndex: 1, winners: [], reason: "draw" });
    m.recordGameResult({ gameIndex: 2, winners: [], reason: "draw" });
    expect(m.getScore(mkPlayerSeat(0)).wins).toBe(0);
    expect(m.getScore(mkPlayerSeat(1)).wins).toBe(0);
    expect(m.isDecided()).toBe(true);
  });

  it("getCurrentGame / setCurrentGame round-trip", () => {
    const m = new Match(mkOptions(1));
    expect(m.getCurrentGame()).toBeNull();
    // We can't easily construct a real Game here without seeding lots of deps;
    // pass a marker object via `as unknown as` since setCurrentGame just stores
    // the reference for the SP2 driver to hand back.
    const marker = { id: "game-marker" } as unknown as import("../game.js").Game;
    m.setCurrentGame(marker);
    expect(m.getCurrentGame()).toBe(marker);
    m.setCurrentGame(null);
    expect(m.getCurrentGame()).toBeNull();
  });

  it("recordGameResult with concede flag marks loser's concededLastGame", () => {
    const m = new Match(mkOptions(3));
    const concede: MatchGameResult = {
      gameIndex: 0,
      winners: [mkPlayerSeat(0)],
      reason: "concede",
    };
    m.recordGameResult(concede, true);
    expect(m.getScore(mkPlayerSeat(0)).concededLastGame).toBe(false);
    expect(m.getScore(mkPlayerSeat(1)).concededLastGame).toBe(true);
  });

  it("subsequent win (non-concede) resets the concededLastGame flag for everyone", () => {
    const m = new Match(mkOptions(3));
    m.recordGameResult({ gameIndex: 0, winners: [mkPlayerSeat(0)], reason: "concede" }, true);
    expect(m.getScore(mkPlayerSeat(1)).concededLastGame).toBe(true);
    m.recordGameResult({ gameIndex: 1, winners: [mkPlayerSeat(1)], reason: "victory" });
    expect(m.getScore(mkPlayerSeat(0)).concededLastGame).toBe(false);
    expect(m.getScore(mkPlayerSeat(1)).concededLastGame).toBe(false);
  });

  it("constructor throws GameStateIntegrityError when player count and deck count mismatch", () => {
    expect(
      () =>
        new Match({
          bestOf: 3,
          players: [alice, bob, charlie],
          decks: [emptyDeck("Alice"), emptyDeck("Bob")],
          formatId: "standard",
        }),
    ).toThrow(GameStateIntegrityError);
    expect(
      () =>
        new Match({
          bestOf: 3,
          players: [alice, bob, charlie],
          decks: [emptyDeck("Alice"), emptyDeck("Bob")],
          formatId: "standard",
        }),
    ).toThrow(/player count .* must match deck count/);
  });

  it("getScore throws GameStateIntegrityError for an unknown seat", () => {
    const m = new Match(mkOptions(1));
    expect(() => m.getScore(mkPlayerSeat(99))).toThrow(GameStateIntegrityError);
    expect(() => m.getScore(mkPlayerSeat(99))).toThrow(/no score for seat/);
  });

  it("sideboardingFlow throws SP2 message", () => {
    const m = new Match(mkOptions(3));
    const gen = m.sideboardingFlow();
    expect(() => gen.next()).toThrow(/SP7 sideboarding flow required/);
  });

  it("Bo1 with a single drawn game: isDecided is true after one game even with no winner", () => {
    // WHY: a draw with bestOf=1 exhausts games — the "all games played"
    // branch of isDecided must return true without anyone reaching the
    // majority-wins threshold. Covers the else-clause in isDecided().
    const m = new Match(mkOptions(1));
    const draw: MatchGameResult = { gameIndex: 0, winners: [], reason: "draw" };
    m.recordGameResult(draw);
    expect(m.getScore(mkPlayerSeat(0)).wins).toBe(0);
    expect(m.getScore(mkPlayerSeat(1)).wins).toBe(0);
    expect(m.isDecided()).toBe(true);
    // computeOverallOutcome should not throw (match IS decided) and should
    // return draw with no winner.
    const outcome = m.computeOverallOutcome();
    expect(outcome.winner).toBeNull();
    expect(outcome.reason).toBe("draw");
  });

  it("getGames returns the recorded games in order", () => {
    const m = new Match(mkOptions(3));
    m.recordGameResult(winForSeat(0, 0));
    m.recordGameResult(winForSeat(1, 1));
    const games = m.getGames();
    expect(games).toHaveLength(2);
    expect(games[0]?.gameIndex).toBe(0);
    expect(games[1]?.gameIndex).toBe(1);
  });

  it("3-player match: two decks for three players throws at construction", () => {
    expect(
      () =>
        new Match({
          bestOf: 1,
          players: [alice, bob, charlie],
          decks: [emptyDeck("Alice"), emptyDeck("Bob")],
          formatId: "standard",
        }),
    ).toThrow();
  });

  it("matchController is stored on the Match and accessible via .matchController", () => {
    const controller = { decide: () => ({ kind: "concedeMatch", concede: true }) as const };
    const m = new Match({ ...mkOptions(3), matchController: controller });
    expect(m.matchController).toBe(controller);
    const m2 = new Match(mkOptions(3));
    expect(m2.matchController).toBeNull();
  });

  it("computeOverallOutcome throws when called on an undecided match", () => {
    const m = new Match(mkOptions(3));
    expect(() => m.computeOverallOutcome()).toThrow(GameStateIntegrityError);
    expect(() => m.computeOverallOutcome()).toThrow(/undecided match/);
  });
});

// === Match.run integration tests ==================================

const rules: GameRules = {
  formatId: "casual",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2026-03-17",
  seed: "0x1234",
};

const stubPaperCard = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

// WHY: Match.run drives runGame, which consumes setupGame + PhaseHandler.
// This factory mints a fresh Game + seeds 60 stub cards per seat and returns
// the controllers the caller provides. Mirrors the integration smoke test's
// seeding strategy so we exercise the same real engine path.
const makeMatchFactory = (
  seatControllers: (gameIndex: number) => Map<PlayerSeat, PlayerController>,
  seedOffset = 0,
): MatchGameFactory => {
  return (gameIndex: number) => {
    const game = new Game({
      lobbyPlayers: [
        { id: "p0", name: "P0", controllerKind: "scripted" },
        { id: "p1", name: "P1", controllerKind: "scripted" },
      ],
      rules,
      meta,
      rng: new SeededRng(BigInt(0x1234 + seedOffset + gameIndex)),
    });
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
        if (!deck) throw new Error("factory: unreachable — deck bucket missing");
        deck.push(id);
      }
    }
    return {
      game,
      decks: decks as unknown as SetupDecks,
      controllers: seatControllers(gameIndex),
    };
  };
};

describe("Match.run", () => {
  it("Bo1: active seat concedes on first priority → match decided in 1 game", () => {
    const match = new Match(mkOptions(1));
    // Both seats scripted with priority=concede — only the active seat
    // (chosen by the setup die-roll) gets prompted and concedes.
    const bothConcede = (): Map<PlayerSeat, PlayerController> => {
      const map = new Map<PlayerSeat, PlayerController>();
      for (const seat of [0, 1]) {
        map.set(
          mkPlayerSeat(seat),
          new ScriptedController([
            { kind: "mulligan", keep: true } as DecisionResponse,
            { kind: "priority", action: { kind: "concede" } } as DecisionResponse,
          ]),
        );
      }
      return map;
    };
    const factory = makeMatchFactory(() => bothConcede());
    const gen = runMatch(match, factory);
    let step = gen.next();
    let safety = 0;
    while (!step.done) {
      safety++;
      if (safety > 20000) throw new Error("runaway Match.run generator");
      if (step.value.kind === "decision") {
        throw new Error("Match.run should consume decisions internally via controllers");
      }
      step = gen.next();
    }
    const outcome = step.value;
    expect(outcome.games).toHaveLength(1);
    expect(outcome.winner).not.toBeNull();
    expect(outcome.reason).toBe("concede");
    // Whichever seat won has wins=1; the other has concededLastGame=true.
    const winner = outcome.winner;
    if (winner === null) throw new Error("unreachable: winner asserted non-null");
    expect(match.getScore(winner).wins).toBe(1);
    const loser = mkPlayerSeat((winner as unknown as number) === 0 ? 1 : 0);
    expect(match.getScore(loser).concededLastGame).toBe(true);
  });

  it("Bo3: whichever-seat-has-priority concedes each game → match decided after 2 games", () => {
    const match = new Match(mkOptions(3));
    // WHY: SP1 priority loop prompts only the active player each step; we
    // don't know who the die-roll picked, so script BOTH seats to concede
    // on first priority. The winner of each game is the non-conceding seat —
    // which must be the same seat every game (die-roll is deterministic
    // per-seed, and the conceding seat is always "the one that got priority").
    // After 2 games, that seat wins the match 2-0.
    const bothConcede = (): Map<PlayerSeat, PlayerController> => {
      const map = new Map<PlayerSeat, PlayerController>();
      for (const seat of [0, 1]) {
        map.set(
          mkPlayerSeat(seat),
          new ScriptedController([
            { kind: "mulligan", keep: true } as DecisionResponse,
            { kind: "priority", action: { kind: "concede" } } as DecisionResponse,
          ]),
        );
      }
      return map;
    };
    const factory = makeMatchFactory(() => bothConcede());
    const gen = runMatch(match, factory);
    let step = gen.next();
    let safety = 0;
    while (!step.done) {
      safety++;
      if (safety > 40000) throw new Error("runaway Match.run generator");
      step = gen.next();
    }
    const outcome = step.value;
    expect(outcome.games).toHaveLength(2);
    // Winner is whichever seat the die-roll picked as NON-active (inactive
    // seat never got priority → never conceded). Its wins count is 2.
    expect(outcome.winner).not.toBeNull();
    if (outcome.winner === null) throw new Error("unreachable");
    expect(match.getScore(outcome.winner).wins).toBe(2);
    expect(match.isDecided()).toBe(true);
    expect(match.getCurrentGame()).toBeNull();
  });

  it("run() throws immediately when called on an already-decided match (Bo1 preloaded)", () => {
    const match = new Match(mkOptions(1));
    match.recordGameResult(winForSeat(0, 0));
    // isDecided is already true — run() must not invoke the factory.
    let factoryCalls = 0;
    const factory: MatchGameFactory = () => {
      factoryCalls++;
      throw new Error("factory should not be called");
    };
    const gen = runMatch(match, factory);
    const step = gen.next();
    expect(step.done).toBe(true);
    expect(factoryCalls).toBe(0);
    const outcome = step.value as Awaited<ReturnType<Match["computeOverallOutcome"]>>;
    expect(outcome.winner).toBe(mkPlayerSeat(0));
    expect(outcome.reason).toBe("victory");
  });
});

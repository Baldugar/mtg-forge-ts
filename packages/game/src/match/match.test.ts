// SPDX-License-Identifier: GPL-3.0-or-later
import type { Deck, LobbyPlayer } from "@mtg-forge-ts/core";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { MatchGameResult, MatchOptions } from "./match.js";
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

  it("constructor throws when player count and deck count mismatch", () => {
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

  it("getScore throws for an unknown seat", () => {
    const m = new Match(mkOptions(1));
    expect(() => m.getScore(mkPlayerSeat(99))).toThrow(/no score for seat/);
  });

  it("sideboardingFlow throws SP2 message", () => {
    const m = new Match(mkOptions(3));
    const gen = m.sideboardingFlow();
    expect(() => gen.next()).toThrow(/SP2 sideboarding flow required/);
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
});

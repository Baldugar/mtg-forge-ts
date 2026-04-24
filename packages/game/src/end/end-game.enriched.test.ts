// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 68 — end-game flow + LossReason taxonomy tests.
// Covers:
//   - terminalState.losses populated with the correct LossReason
//   - legacy concededSeats populated in sync
//   - 2-player loss: winner derived correctly (via endGameCleanup)
//   - 2-player simultaneous loss: outcome=draw
//   - 3-player partial loss: one removePlayerFromGame invocation
//   - 3-player total loss: winner is sole survivor, full CR 800.4 cleanup
//   - GameEnded event payload {winners, reason}
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { PlayerLoss } from "../terminal-state.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { endGame, endGameCleanup } from "./end-game.js";

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const rules2: GameRules = {
  formatId: "standard",
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

const rules3: GameRules = { ...rules2, playerCount: { min: 3, max: 3 } };

const mkLobby = (id: string): LobbyPlayer => ({ id, name: id, controllerKind: "human" });

const seedZones = (game: Game): void => {
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
};

const mkGame2 = (): Game => {
  const g = new Game({
    lobbyPlayers: [mkLobby("p0"), mkLobby("p1")],
    rules: rules2,
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(g);
  return g;
};

const mkGame3 = (): Game => {
  const g = new Game({
    lobbyPlayers: [mkLobby("p0"), mkLobby("p1"), mkLobby("p2")],
    rules: rules3,
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(g);
  return g;
};

const drain = <R>(g: Generator<EngineYield, R, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = g.next();
  while (!step.done) {
    out.push(step.value);
    step = g.next({ order: [] });
  }
  return out;
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): void => {
  const c = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, c);
  const z = game.getPlayer(seat).zones.get(zone);
  z?.add(id);
};

describe("endGame enrichment (SP2 Task 68)", () => {
  it("records losses with LossReason on the terminal state", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason: "lifeLoss" }];
    endGame(g, { kind: "win", winner: mkPlayerSeat(0), reason: "lethal" }, [], losses);
    expect(g.terminalState?.losses).toEqual(losses);
  });

  it("derives legacy concededSeats from losses whose reason is 'concede'", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason: "concede" }];
    endGame(g, { kind: "win", winner: mkPlayerSeat(0), reason: "concede" }, [], losses);
    expect(g.terminalState?.concededSeats).toEqual([mkPlayerSeat(1)]);
  });

  it("does NOT classify lifeLoss as conceded", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason: "lifeLoss" }];
    endGame(g, { kind: "win", winner: mkPlayerSeat(0), reason: "lethal" }, [], losses);
    expect(g.terminalState?.concededSeats).toEqual([]);
  });

  it("derives PlayerLoss roster from concededSeats when no losses passed (backwards compat)", () => {
    const g = mkGame2();
    endGame(g, { kind: "win", winner: mkPlayerSeat(0), reason: "concede" }, [mkPlayerSeat(1)]);
    expect(g.terminalState?.losses).toEqual([{ seat: mkPlayerSeat(1), reason: "concede" }]);
  });
});

describe("endGameCleanup (SP2 Task 68)", () => {
  it("2-player life-loss: outcome=win, winner derived, GameEnded reason=victory", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason: "lifeLoss" }];
    const yields = drain(endGameCleanup(g, losses));
    expect(g.terminalState?.outcome.kind).toBe("win");
    if (g.terminalState?.outcome.kind === "win") {
      expect(g.terminalState.outcome.winner).toBe(mkPlayerSeat(0));
    }
    const gameEnded = yields.find((y) => y.kind === "event" && y.event.kind === "GameEnded");
    if (!gameEnded || gameEnded.kind !== "event" || gameEnded.event.kind !== "GameEnded") {
      throw new Error("missing GameEnded");
    }
    expect(gameEnded.event.payload.winners).toEqual([mkPlayerSeat(0)]);
    expect(gameEnded.event.payload.reason).toBe("victory");
  });

  it("2-player simultaneous loss: outcome=draw, losses has 2 entries", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [
      { seat: mkPlayerSeat(0), reason: "lifeLoss" },
      { seat: mkPlayerSeat(1), reason: "lifeLoss" },
    ];
    drain(endGameCleanup(g, losses));
    expect(g.terminalState?.outcome.kind).toBe("draw");
    expect(g.terminalState?.losses).toHaveLength(2);
  });

  it("2-player concede: GameEnded reason=concede", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(0), reason: "concede" }];
    const yields = drain(endGameCleanup(g, losses));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "GameEnded");
    if (!ev || ev.kind !== "event" || ev.event.kind !== "GameEnded") {
      throw new Error("missing");
    }
    expect(ev.event.payload.reason).toBe("concede");
  });

  it("3-player: two losses simultaneously leaves one winner + runs CR 800.4 cleanup", () => {
    const g = mkGame3();
    // Seed each player with one creature on their battlefield.
    addCard(g, mkPlayerSeat(0), ZoneType.Battlefield, mkEntityId(10));
    addCard(g, mkPlayerSeat(1), ZoneType.Battlefield, mkEntityId(20));
    addCard(g, mkPlayerSeat(2), ZoneType.Battlefield, mkEntityId(30));
    const losses: PlayerLoss[] = [
      { seat: mkPlayerSeat(0), reason: "lifeLoss" },
      { seat: mkPlayerSeat(1), reason: "lifeLoss" },
    ];
    drain(endGameCleanup(g, losses));
    // p0 and p1's cards removed from game; p2's still there.
    expect(g.cards.has(mkEntityId(10))).toBe(false);
    expect(g.cards.has(mkEntityId(20))).toBe(false);
    expect(g.cards.has(mkEntityId(30))).toBe(true);
    expect(g.terminalState?.outcome.kind).toBe("win");
    if (g.terminalState?.outcome.kind === "win") {
      expect(g.terminalState.outcome.winner).toBe(mkPlayerSeat(2));
    }
  });

  it("2-player games skip CR 800.4 cleanup (cards remain)", () => {
    const g = mkGame2();
    addCard(g, mkPlayerSeat(1), ZoneType.Battlefield, mkEntityId(100));
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason: "lifeLoss" }];
    drain(endGameCleanup(g, losses));
    // In a 2-player game the match ends; per our policy, no cleanup.
    expect(g.cards.has(mkEntityId(100))).toBe(true);
  });

  it("GameEnded event carries the winners array", () => {
    const g = mkGame2();
    const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason: "poisonLoss" }];
    const yields = drain(endGameCleanup(g, losses));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "GameEnded");
    if (!ev || ev.kind !== "event" || ev.event.kind !== "GameEnded") {
      throw new Error("missing event");
    }
    expect(ev.event.payload.winners).toEqual([mkPlayerSeat(0)]);
  });

  it("each LossReason variant round-trips through terminal state", () => {
    const cases: readonly PlayerLoss["reason"][] = [
      "lifeLoss",
      "poisonLoss",
      "libraryLoss",
      "concede",
      "commanderDamage",
      "antePaid",
      "gameDrawn",
      "effect",
    ];
    for (const reason of cases) {
      const g = mkGame2();
      const losses: PlayerLoss[] = [{ seat: mkPlayerSeat(1), reason }];
      endGame(g, { kind: "win", winner: mkPlayerSeat(0), reason }, [], losses);
      expect(g.terminalState?.losses?.[0]?.reason).toBe(reason);
    }
  });
});

describe("SbaEngine terminal-state enrichment (SP2 Task 68)", () => {
  it("SBA loss produces a PlayerLoss entry in terminalState.losses", () => {
    const g = mkGame2();
    // Run an SBA loss by setting life to 0 and sweeping.
    g.getPlayer(mkPlayerSeat(0)).life = 0;
    drain(g.sbaEngine.sweep());
    expect(g.terminalState?.losses).toBeDefined();
    const losses = g.terminalState?.losses ?? [];
    expect(losses).toHaveLength(1);
    expect(losses[0]?.seat).toBe(mkPlayerSeat(0));
    expect(losses[0]?.reason).toBe("lifeLoss");
    // Legacy field still populated.
    expect(g.terminalState?.concededSeats).toEqual([mkPlayerSeat(0)]);
  });

  it("SBA poison loss produces reason=poisonLoss", () => {
    const g = mkGame2();
    g.getPlayer(mkPlayerSeat(1)).counters.set(CounterType.Poison, 10);
    drain(g.sbaEngine.sweep());
    expect(g.terminalState?.losses?.[0]?.reason).toBe("poisonLoss");
  });

  it("SBA library-loss produces reason=libraryLoss", () => {
    const g = mkGame2();
    g.getPlayer(mkPlayerSeat(1)).failedDrawFromEmptyLibrary = true;
    drain(g.sbaEngine.sweep());
    expect(g.terminalState?.losses?.[0]?.reason).toBe("libraryLoss");
  });
});

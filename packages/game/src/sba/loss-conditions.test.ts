// SPDX-License-Identifier: GPL-3.0-or-later
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
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

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
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const runSweep = (game: Game): EngineYield[] => {
  const yields: EngineYield[] = [];
  const gen = game.sbaEngine.sweep();
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return yields;
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const countEvents = (ys: EngineYield[], kind: string): number =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind).length;

describe("loss-conditions — player loss SBAs (CR 704.5a/b/c)", () => {
  it("player at 0 life → playerLosesLifeZero, marked lost, PlayerLost emitted", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).life = 0;
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(1);
    expect(game.terminalState?.concededSeats).toContain(mkPlayerSeat(0));
  });

  it("player at negative life → playerLosesLifeZero", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).life = -5;
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(1);
    const lost = ys.find((y) => y.kind === "event" && y.event.kind === "PlayerLost");
    if (lost?.kind !== "event" || lost.event.kind !== "PlayerLost") throw new Error("event expected");
    expect(lost.event.payload.reason).toBe("life");
  });

  it("player with 10 poison counters → playerLosesPoison", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 10);
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(1);
    const ev = ys.find((y) => y.kind === "event" && y.event.kind === "PlayerLost");
    if (ev?.kind !== "event" || ev.event.kind !== "PlayerLost") throw new Error("event expected");
    expect(ev.event.payload.reason).toBe("poison");
  });

  it("player with 11 poison counters → playerLosesPoison", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 11);
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(1);
  });

  it("player with 9 poison counters — no loss", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 9);
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(0);
  });

  it("player with failedDrawFromEmptyLibrary=true → playerLosesEmptyDraw with reason 'decked'", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).failedDrawFromEmptyLibrary = true;
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(1);
    const ev = ys.find((y) => y.kind === "event" && y.event.kind === "PlayerLost");
    if (ev?.kind !== "event" || ev.event.kind !== "PlayerLost") throw new Error("event expected");
    expect(ev.event.payload.reason).toBe("decked");
    // Flag cleared so a second sweep doesn't re-fire.
    expect(game.getPlayer(mkPlayerSeat(0)).failedDrawFromEmptyLibrary).toBe(false);
  });

  it("already-lost player is skipped on the next sweep", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).life = 0;
    runSweep(game); // first loss
    // A second sweep with life still 0 should not emit another PlayerLost.
    const ys2 = runSweep(game);
    expect(countEvents(ys2, "PlayerLost")).toBe(0);
  });

  it("last surviving player is marked winner in terminalState", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).life = 0;
    runSweep(game);
    expect(game.terminalState?.outcome.kind).toBe("win");
    if (game.terminalState?.outcome.kind === "win") {
      expect(game.terminalState.outcome.winner).toBe(mkPlayerSeat(1));
    }
    expect(game.terminalState?.concededSeats).toContain(mkPlayerSeat(0));
  });

  it("custom poisonCountersToLose (2HG = 15) honored", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules: { ...rules, poisonCountersToLose: 15 },
      meta,
      rng: new SeededRng(1n),
    });
    seedZones(game);
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 10);
    const ys1 = runSweep(game);
    expect(countEvents(ys1, "PlayerLost")).toBe(0);
    game.getPlayer(mkPlayerSeat(0)).counters.set(CounterType.Poison, 15);
    const ys2 = runSweep(game);
    expect(countEvents(ys2, "PlayerLost")).toBe(1);
  });

  it("addCard fixture helper does not affect loss checks", () => {
    // Regression: verifying cards on battlefield don't accidentally count
    // as players for loss SBAs.
    const game = mkGame();
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, mkEntityId(1));
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(0);
  });
});

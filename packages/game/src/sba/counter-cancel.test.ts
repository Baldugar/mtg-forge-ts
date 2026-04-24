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

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const drain = (game: Game): void => {
  const gen = game.sbaEngine.sweep();
  let step = gen.next();
  while (!step.done) step = gen.next();
};

describe("counter-cancel — CR 704.5r", () => {
  it("permanent with 3 +1/+1 and 2 -1/-1 → 1 +1/+1 remains, both -1/-1 removed", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.counters.set(CounterType.PlusOnePlusOne, 3);
    card.counters.set(CounterType.MinusOneMinusOne, 2);
    drain(game);
    expect(card.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
    expect(card.counters.has(CounterType.MinusOneMinusOne)).toBe(false);
  });

  it("permanent with equal +1/+1 and -1/-1 → both cleared", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.counters.set(CounterType.PlusOnePlusOne, 2);
    card.counters.set(CounterType.MinusOneMinusOne, 2);
    drain(game);
    expect(card.counters.has(CounterType.PlusOnePlusOne)).toBe(false);
    expect(card.counters.has(CounterType.MinusOneMinusOne)).toBe(false);
  });

  it("permanent with only +1/+1 counters → no cancel", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.counters.set(CounterType.PlusOnePlusOne, 2);
    drain(game);
    expect(card.counters.get(CounterType.PlusOnePlusOne)).toBe(2);
  });

  it("permanent with only -1/-1 counters → no cancel", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.counters.set(CounterType.MinusOneMinusOne, 3);
    drain(game);
    expect(card.counters.get(CounterType.MinusOneMinusOne)).toBe(3);
  });

  it("card in graveyard → ignored (only battlefield permanents cancel)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    card.counters.set(CounterType.PlusOnePlusOne, 3);
    card.counters.set(CounterType.MinusOneMinusOne, 2);
    drain(game);
    // Unchanged.
    expect(card.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
    expect(card.counters.get(CounterType.MinusOneMinusOne)).toBe(2);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 74 — GameFlags per-turn tracking.
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
import { GameAction } from "./action/game-action.js";
import { Card } from "./card.js";
import { createDefaultFlags } from "./game-flags.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";

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
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const place = (game: Game, seat: PlayerSeat, id: EntityId, zone: ZoneType): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  game.getPlayer(seat).zones.get(zone)?.add(id);
  return card;
};

const drain = (gen: Generator<unknown, unknown, unknown>): void => {
  let step = gen.next();
  while (!step.done) step = gen.next();
};

describe("GameFlags — default per-turn slots (Task 74)", () => {
  it("createDefaultFlags initializes empty countersAddedThisTurn / leftBattlefieldThisTurn / topLibsCast", () => {
    const f = createDefaultFlags();
    expect(f.countersAddedThisTurn.size).toBe(0);
    expect(f.leftBattlefieldThisTurn.size).toBe(0);
    expect(f.topLibsCast.size).toBe(0);
  });
});

describe("addCounter mutates countersAddedThisTurn (Task 74)", () => {
  it("accumulates counts across multiple addCounter calls", () => {
    const game = mkGame();
    const action = new GameAction(game);
    const id = mkEntityId(10);
    place(game, mkPlayerSeat(0), id, ZoneType.Battlefield);
    drain(action.addCounter(id, CounterType.PlusOnePlusOne, 2));
    drain(action.addCounter(id, CounterType.Charge, 1));
    expect(game.flags.countersAddedThisTurn.get(id)).toBe(3);
  });

  it("tracks counts per-card independently", () => {
    const game = mkGame();
    const action = new GameAction(game);
    const a = mkEntityId(10);
    const b = mkEntityId(11);
    place(game, mkPlayerSeat(0), a, ZoneType.Battlefield);
    place(game, mkPlayerSeat(0), b, ZoneType.Battlefield);
    drain(action.addCounter(a, CounterType.PlusOnePlusOne, 1));
    drain(action.addCounter(b, CounterType.PlusOnePlusOne, 3));
    expect(game.flags.countersAddedThisTurn.get(a)).toBe(1);
    expect(game.flags.countersAddedThisTurn.get(b)).toBe(3);
  });
});

describe("moveTo mutates leftBattlefieldThisTurn (Task 74)", () => {
  it("sets leftBattlefieldThisTurn on battlefield → graveyard transition", () => {
    const game = mkGame();
    const action = new GameAction(game);
    const id = mkEntityId(10);
    place(game, mkPlayerSeat(0), id, ZoneType.Battlefield);
    drain(action.moveTo(id, ZoneType.Graveyard));
    expect(game.flags.leftBattlefieldThisTurn.has(id)).toBe(true);
  });

  it("does NOT set leftBattlefieldThisTurn on non-battlefield source", () => {
    const game = mkGame();
    const action = new GameAction(game);
    const id = mkEntityId(10);
    place(game, mkPlayerSeat(0), id, ZoneType.Hand);
    drain(action.moveTo(id, ZoneType.Graveyard));
    expect(game.flags.leftBattlefieldThisTurn.has(id)).toBe(false);
  });

  it("does NOT set leftBattlefieldThisTurn on battlefield → battlefield (no-op)", () => {
    // CR: a permanent already on the battlefield moving to the battlefield
    // is a no-op at the intent level but the generator's moveTo still fires
    // if invoked. We check the flag is not set because fromZone===toZone.
    const game = mkGame();
    const action = new GameAction(game);
    const id = mkEntityId(10);
    place(game, mkPlayerSeat(0), id, ZoneType.Battlefield);
    drain(action.moveTo(id, ZoneType.Battlefield));
    expect(game.flags.leftBattlefieldThisTurn.has(id)).toBe(false);
  });
});

describe("Card.remembered / imprinted defaults + snapshot (Task 74)", () => {
  it("Card.remembered and Card.imprinted are empty arrays by default", () => {
    const id = mkEntityId(10);
    const card = new Card(id, paper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    expect(card.remembered).toEqual([]);
    expect(card.imprinted).toEqual([]);
  });

  it("Card.toJSON includes remembered and imprinted", () => {
    const id = mkEntityId(10);
    const card = new Card(id, paper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    card.remembered = [mkEntityId(20), mkEntityId(21)];
    card.imprinted = [mkEntityId(30)];
    const json = card.toJSON();
    expect(json.remembered).toEqual([mkEntityId(20), mkEntityId(21)]);
    expect(json.imprinted).toEqual([mkEntityId(30)]);
  });
});

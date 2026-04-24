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

// Inject a subtype via cache mutation.
const markSubtype = (game: Game, id: EntityId, subtype: string): void => {
  const chars = game.layerEngine.computeCharacteristics(id);
  chars.subtypes.add(subtype);
};

const drain = (game: Game): void => {
  const gen = game.sbaEngine.sweep();
  let step = gen.next();
  while (!step.done) step = gen.next();
};

describe("saga-class — CR 704.5v + Class level gain", () => {
  it("Saga with final-chapter-resolved flag → sacrificed (moved to graveyard)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    markSubtype(game, id, "Saga");
    card.sagaFinalChapterResolved = true;
    drain(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("Saga without the flag → stays on battlefield", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    markSubtype(game, id, "Saga");
    drain(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("Class permanent with no Level counter → gains Level 1", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    markSubtype(game, id, "Class");
    drain(game);
    expect(card.counters.get(CounterType.Level)).toBe(1);
  });

  it("Class permanent with a Level counter → no SBA", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    markSubtype(game, id, "Class");
    card.counters.set(CounterType.Level, 2);
    drain(game);
    expect(card.counters.get(CounterType.Level)).toBe(2);
  });

  it("non-Saga / non-Class permanent → no interaction", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.sagaFinalChapterResolved = true; // flag set but card is not a Saga
    drain(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });
});

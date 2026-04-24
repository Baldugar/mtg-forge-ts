// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "commander",
  startingLife: 40,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: ["Commander"],
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
    player.zones.set(ZoneType.Command, new CommandZone(ZoneType.Command, player.seat));
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

const addCardToExile = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Exile);
  game.cards.set(id, card);
  game.sharedZones.exile.add(id);
  return card;
};

describe("bestow-commander — CR 702.103 + 903.9", () => {
  it("bestowed card in graveyard → bestowed flag cleared", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    card.bestowed = true;
    drain(game);
    expect(card.bestowed).toBe(false);
  });

  it("bestowed card on battlefield → flag stays (aura form)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.bestowed = true;
    drain(game);
    expect(card.bestowed).toBe(true);
  });

  it("commander in graveyard → moved to command zone", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    card.isCommander = true;
    drain(game);
    expect(card.zone).toBe(ZoneType.Command);
    const cmd = game.getPlayer(seat).zones.get(ZoneType.Command);
    expect(cmd?.contains(id)).toBe(true);
  });

  it("commander in exile → moved to command zone", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCardToExile(game, seat, id);
    card.isCommander = true;
    drain(game);
    expect(card.zone).toBe(ZoneType.Command);
  });

  it("commander on battlefield → stays", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.isCommander = true;
    drain(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("commander already in command zone → no SBA", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Command, id);
    card.isCommander = true;
    drain(game);
    expect(card.zone).toBe(ZoneType.Command);
  });

  it("non-commander in graveyard → no SBA", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    drain(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });
});

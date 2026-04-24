// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
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

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

// Shim the layer cache: mutate chars directly after first compute.
const markSubtype = (game: Game, id: EntityId, subtype: string): void => {
  const chars = game.layerEngine.computeCharacteristics(id);
  chars.subtypes.add(subtype);
};
const markType = (game: Game, id: EntityId, type: CardType): void => {
  const chars = game.layerEngine.computeCharacteristics(id);
  chars.types.add(type);
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

describe("attachment-legality — CR 704.5n/p/q", () => {
  it("aura attached to nothing → graveyard", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const aura = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    markSubtype(game, aura.id, "Aura");
    runSweep(game);
    expect(aura.zone).toBe(ZoneType.Graveyard);
  });

  it("aura attached to a valid battlefield permanent → stays", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const target = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    const aura = addCard(game, seat, ZoneType.Battlefield, mkEntityId(2));
    aura.attachedTo = target.id;
    target.attachments = [aura.id];
    markSubtype(game, aura.id, "Aura");
    runSweep(game);
    expect(aura.zone).toBe(ZoneType.Battlefield);
  });

  it("aura attached to a card in graveyard → graveyard", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const target = addCard(game, seat, ZoneType.Graveyard, mkEntityId(1));
    const aura = addCard(game, seat, ZoneType.Battlefield, mkEntityId(2));
    aura.attachedTo = target.id;
    markSubtype(game, aura.id, "Aura");
    runSweep(game);
    expect(aura.zone).toBe(ZoneType.Graveyard);
  });

  it("equipment attached to a non-creature → unattaches (not moved)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const target = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    const eq = addCard(game, seat, ZoneType.Battlefield, mkEntityId(2));
    eq.attachedTo = target.id;
    target.attachments = [eq.id];
    markSubtype(game, eq.id, "Equipment");
    // target has no types → non-creature.
    runSweep(game);
    expect(eq.zone).toBe(ZoneType.Battlefield);
    expect(eq.attachedTo).toBeNull();
    expect(target.attachments).toEqual([]);
  });

  it("equipment attached to a creature → stays", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const creature = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    const eq = addCard(game, seat, ZoneType.Battlefield, mkEntityId(2));
    eq.attachedTo = creature.id;
    creature.attachments = [eq.id];
    markSubtype(game, eq.id, "Equipment");
    markType(game, creature.id, CardType.Creature);
    runSweep(game);
    expect(eq.attachedTo).toBe(creature.id);
  });

  it("unattached equipment on the battlefield → ignored", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const eq = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    markSubtype(game, eq.id, "Equipment");
    runSweep(game);
    expect(eq.zone).toBe(ZoneType.Battlefield);
    expect(eq.attachedTo).toBeNull();
  });

  it("fortification attached to a non-land → unattaches", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const target = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    const fort = addCard(game, seat, ZoneType.Battlefield, mkEntityId(2));
    fort.attachedTo = target.id;
    target.attachments = [fort.id];
    markSubtype(game, fort.id, "Fortification");
    runSweep(game);
    expect(fort.attachedTo).toBeNull();
  });

  it("fortification attached to a land → stays", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const land = addCard(game, seat, ZoneType.Battlefield, mkEntityId(1));
    const fort = addCard(game, seat, ZoneType.Battlefield, mkEntityId(2));
    fort.attachedTo = land.id;
    land.attachments = [fort.id];
    markSubtype(game, fort.id, "Fortification");
    markType(game, land.id, CardType.Land);
    runSweep(game);
    expect(fort.attachedTo).toBe(land.id);
  });
});

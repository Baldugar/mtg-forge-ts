// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
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

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

// Apply a "becomes type + P/T" global layer effect to every card.
const setTypeAndPT = (game: Game, type: CardType, power: number, toughness: number, timestamp = 1): void => {
  game.layerEngine.typeEffects.push({
    kind: "becomes",
    types: new Set([type]),
    isCda: false,
    timestamp,
    sourceAbilityId: null,
  });
  game.layerEngine.pt7b.push({
    kind: "set",
    power,
    toughness,
    timestamp,
    sourceAbilityId: null,
  });
  game.layerEngine.bumpEpoch("test: set type/pt");
};

const setType = (game: Game, type: CardType, timestamp = 1): void => {
  game.layerEngine.typeEffects.push({
    kind: "becomes",
    types: new Set([type]),
    isCda: false,
    timestamp,
    sourceAbilityId: null,
  });
  game.layerEngine.bumpEpoch("test: set type");
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

describe("creature-removal — CR 704.5f/g/i/s", () => {
  it("creature with toughness 0 → moved to graveyard", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 1, 0);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("creature with negative toughness → moved to graveyard", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 1, -1);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("creature with damage >= toughness → destroyed (lethal damage)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 1, 3);
    card.damage = 3;
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("creature with damage < toughness → no SBA fires", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 1, 3);
    card.damage = 2;
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("planeswalker with 0 loyalty counters → graveyard", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setType(game, CardType.Planeswalker);
    // Loyalty counter defaults to 0 (no counter set).
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("planeswalker with positive loyalty counters → stays", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setType(game, CardType.Planeswalker);
    card.counters.set(CounterType.Loyalty, 3);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("battle with 0 defense counters → exiled", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setType(game, CardType.Battle);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Exile);
  });

  it("battle with positive defense counters → stays", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setType(game, CardType.Battle);
    card.counters.set(CounterType.Defense, 3);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("non-creature / non-PW / non-battle on battlefield → ignored", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    // No type applied (base characteristics has empty types). Damage and
    // lack of counters shouldn't destroy a non-creature/PW/battle.
    card.damage = 99;
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("creature in graveyard → ignored (only battlefield)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    setTypeAndPT(game, CardType.Creature, 1, 0);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard); // unchanged
  });

  it("multiple lethal-damage creatures destroy in one batch", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id1 = mkEntityId(1);
    const id2 = mkEntityId(2);
    const c1 = addCard(game, seat, ZoneType.Battlefield, id1);
    const c2 = addCard(game, seat, ZoneType.Battlefield, id2);
    setTypeAndPT(game, CardType.Creature, 2, 2);
    c1.damage = 2;
    c2.damage = 2;
    runSweep(game);
    expect(c1.zone).toBe(ZoneType.Graveyard);
    expect(c2.zone).toBe(ZoneType.Graveyard);
  });

  it("zero toughness supersedes lethal-damage for the same creature", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 1, 0);
    card.damage = 100;
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  // SP2 Task 78 (fix 2) — CR 702.2b deathtouch: any nonzero damage from a
  // deathtouch source destroys the creature via SBA. Flag set by
  // GameAction.damage and read here.
  it("creature with any damage from a deathtouch source is destroyed (CR 702.2b)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 5, 5);
    card.damage = 1; // 1 damage << 5 toughness, but …
    card.damagedByDeathtouch = true;
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("creature with damagedByDeathtouch but zero damage is NOT destroyed", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    setTypeAndPT(game, CardType.Creature, 5, 5);
    card.damage = 0;
    card.damagedByDeathtouch = true;
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });
});

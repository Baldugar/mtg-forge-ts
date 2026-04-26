// SPDX-License-Identifier: GPL-3.0-or-later
// ManaEffect tests — verifies mana production into the controller's pool.
import "./mana.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    // ManaEffect needs a live ManaPool; Player.manaPool starts as null (SP1 stub).
    player.manaPool = new ManaPool();
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("ManaEffect", () => {
  it("Produced$ G — adds one green mana to controller's pool", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Mana",
          params: { Produced: { kind: "literal", raw: "G" } },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    const shards = pool.toArray();
    expect(shards[0]).toBeInstanceOf(ManaProduced);
    expect((shards[0] as ManaProduced).color).toBe(Color.Green);
  });

  it("Produced$ G G — adds two green mana", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Mana",
          params: { Produced: { kind: "literal", raw: "G G" } },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(2);
    for (const shard of pool.toArray()) {
      expect((shard as ManaProduced).color).toBe(Color.Green);
    }
  });

  it("Produced$ Combo R G — MVP picks first color (Red)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Mana",
          params: { Produced: { kind: "literal", raw: "Combo R G" } },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    expect((pool.toArray()[0] as ManaProduced).color).toBe(Color.Red);
  });

  it("Produced$ Any — MVP adds one colorless mana", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Mana",
          params: { Produced: { kind: "literal", raw: "Any" } },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    expect((pool.toArray()[0] as ManaProduced).color).toBeNull();
  });

  it("Restriction$ NonCreatureNonActivated — Powerstone-style {C} carries the restriction tag (Wave 29)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Mana",
          params: {
            Produced: { kind: "literal", raw: "C" },
            Restriction: { kind: "literal", raw: "NonCreatureNonActivated" },
          },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    const atom = pool.toArray()[0] as ManaProduced;
    expect(atom.color).toBeNull();
    expect(atom.restriction).toBe("nonCreatureNonActivated");
  });

  it("Produced$ W — adds one white mana", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Mana",
          params: { Produced: { kind: "literal", raw: "W" } },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    expect((pool.toArray()[0] as ManaProduced).color).toBe(Color.White);
  });
});

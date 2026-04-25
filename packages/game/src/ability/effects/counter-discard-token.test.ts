// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for counter effects (PutCounter, RemoveCounter), DiscardEffect, and TokenEffect stub.
import "../../svar/selectors/number.js";
import "./put-counter.js";
import "./remove-counter.js";
import "./discard.js";
import "./token.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
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
  name: "Test",
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
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

// ────────────────────────────────────────────────────────────────────────────
// PutCounterEffect
// ────────────────────────────────────────────────────────────────────────────

describe("PutCounterEffect", () => {
  it("puts N +1/+1 counters on a target creature", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(creatureId, creature);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(creatureId);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PutCounter",
          params: {
            CounterType: { kind: "literal", raw: CounterType.PlusOnePlusOne },
            CounterNum: { kind: "literal", raw: "3" },
          },
        },
        cost: { raw: "2 G" },
      },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(creature.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
  });

  it("no-op when targets list is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PutCounter",
          params: {
            CounterType: { kind: "literal", raw: CounterType.PlusOnePlusOne },
            CounterNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "1 G" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// RemoveCounterEffect
// ────────────────────────────────────────────────────────────────────────────

describe("RemoveCounterEffect", () => {
  it("removes N +1/+1 counters from a target creature", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    creature.counters.set(CounterType.PlusOnePlusOne, 5);
    game.cards.set(creatureId, creature);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(creatureId);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RemoveCounter",
          params: {
            CounterType: { kind: "literal", raw: CounterType.PlusOnePlusOne },
            CounterNum: { kind: "literal", raw: "2" },
          },
        },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(creature.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
  });

  it("no-op when the target has no counter of that type", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    // No counters on creature.
    game.cards.set(creatureId, creature);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(creatureId);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RemoveCounter",
          params: {
            CounterType: { kind: "literal", raw: CounterType.PlusOnePlusOne },
            CounterNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    expect(creature.counters.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DiscardEffect
// ────────────────────────────────────────────────────────────────────────────

describe("DiscardEffect", () => {
  it("discards NumCards$ cards from controller's hand to graveyard", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const handCard1 = mkEntityId(50);
    const handCard2 = mkEntityId(51);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const hc1 = new Card(handCard1, paper, seat0, seat0, ZoneType.Hand);
    const hc2 = new Card(handCard2, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(handCard1, hc1);
    game.cards.set(handCard2, hc2);

    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    hand?.add(handCard1);
    hand?.add(handCard2);

    expect(hand?.toArray()).toHaveLength(2);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Discard", params: { NumCards: { kind: "literal", raw: "1" } } },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    // One card moved to graveyard.
    expect(gy?.toArray()).toHaveLength(1);
    // One card remains in hand.
    expect(hand?.toArray()).toHaveLength(1);
  });

  it("no-op when controller's hand is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Discard", params: { NumCards: { kind: "literal", raw: "2" } } },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.toArray()).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TokenEffect (now fully implemented — Part D Wave 3 unstub)
// ────────────────────────────────────────────────────────────────────────────

describe("TokenEffect (SP3 Part D Wave 3)", () => {
  it("is registered in the effectRegistry under handlerKey 'Token'", () => {
    // The import at the top of this file registers TokenEffect.
    // SpellAbility.makeResolver will find it (no "no registered effect" error).
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Token", params: {} }, cost: { raw: "2 G" } },
      sourceId,
      seat0,
      new Map(),
    );

    // Resolves successfully (creates a 0/0 colorless Token) — no longer a stub.
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });

  it("throws a clear deferred error when TokenScript$ is present", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Token",
          params: { TokenScript: { kind: "literal", raw: "w_1_1_soldier" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    expect(() => drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>)).toThrow(
      /TokenScript\$.*SP4/i,
    );
  });
});

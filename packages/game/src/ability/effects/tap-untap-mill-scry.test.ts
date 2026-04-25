// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for tap/untap, mill, and scry effect handlers.
import "../../svar/selectors/number.js";
import "./tap.js";
import "./untap.js";
import "./mill.js";
import "./scry.js";
import type { DecisionResponse, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
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

// Simple drain — for generators that do NOT yield decision requests.
const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

// Decision-aware drain: when a "decision" yield is encountered, immediately
// replies with the provided response so the generator can continue.
const drainWithDecision = (gen: Generator<unknown, void, unknown>, response: DecisionResponse): void => {
  let r = gen.next();
  while (!r.done) {
    const y = r.value as { kind?: string } | undefined;
    if (y && y.kind === "decision") {
      r = gen.next(response);
    } else {
      r = gen.next();
    }
  }
};

// ────────────────────────────────────────────────────────────────────────────
// TapEffect
// ────────────────────────────────────────────────────────────────────────────

describe("TapEffect", () => {
  it("taps a target creature — Card.tapped becomes true", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(creatureId);

    expect(creature.tapped).toBe(false);

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Tap", params: {} }, cost: { raw: "1 U" } },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(creature.tapped).toBe(true);
  });

  it("no-op when targets list is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Tap", params: {} }, cost: { raw: "1" } },
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
// UntapEffect
// ────────────────────────────────────────────────────────────────────────────

describe("UntapEffect", () => {
  it("untaps a tapped creature — Card.tapped becomes false", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    creature.tapped = true;
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(creatureId);

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Untap", params: {} }, cost: { raw: "1 G" } },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(creature.tapped).toBe(false);
  });

  it("no-op when targets list is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Untap", params: {} }, cost: { raw: "1" } },
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
// MillEffect
// ────────────────────────────────────────────────────────────────────────────

describe("MillEffect", () => {
  it("mills NumCards$ cards from the controller's library to graveyard", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const card1Id = mkEntityId(30);
    const card2Id = mkEntityId(31);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(card1Id, paper, seat0, seat0, ZoneType.Library);
    const card2 = new Card(card2Id, paper, seat0, seat0, ZoneType.Library);
    game.cards.set(card1Id, card1);
    game.cards.set(card2Id, card2);

    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    lib?.add(card1Id);
    lib?.add(card2Id);

    expect(lib?.toArray()).toHaveLength(2);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Mill", params: { NumCards: { kind: "literal", raw: "2" } } },
        cost: { raw: "1 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(lib?.toArray()).toHaveLength(0);
    expect(gy?.toArray()).toHaveLength(2);
    expect(card1.zone).toBe(ZoneType.Graveyard);
    expect(card2.zone).toBe(ZoneType.Graveyard);
  });

  it("mills fewer cards than requested when library has fewer", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const card1Id = mkEntityId(30);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(card1Id, paper, seat0, seat0, ZoneType.Library);
    game.cards.set(card1Id, card1);
    game.getPlayer(seat0).zones.get(ZoneType.Library)?.add(card1Id);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Mill", params: { NumCards: { kind: "literal", raw: "3" } } },
        cost: { raw: "1 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    // Should not throw even if there are fewer cards than requested.
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.toArray()).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ScryEffect
// ────────────────────────────────────────────────────────────────────────────

describe("ScryEffect", () => {
  it("scries ScryNum$ cards — top card stays on top when sent back to top", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const card1Id = mkEntityId(40);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(card1Id, paper, seat0, seat0, ZoneType.Library);
    game.cards.set(card1Id, card1);
    game.getPlayer(seat0).zones.get(ZoneType.Library)?.add(card1Id);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Scry", params: { ScryNum: { kind: "literal", raw: "1" } } },
        cost: { raw: "1 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const scryResponse: DecisionResponse = {
      kind: "scry",
      toTop: [card1Id as unknown as EntityId],
      toBottom: [],
    };

    drainWithDecision(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, scryResponse);

    // Card sent back to top remains in library.
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    expect(lib?.toArray()).toContain(card1Id);
  });

  it("scries 1 card — sends to bottom when specified in response", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const card1Id = mkEntityId(40);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(card1Id, paper, seat0, seat0, ZoneType.Library);
    game.cards.set(card1Id, card1);
    game.getPlayer(seat0).zones.get(ZoneType.Library)?.add(card1Id);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Scry", params: { ScryNum: { kind: "literal", raw: "1" } } },
        cost: { raw: "1 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const scryResponse: DecisionResponse = {
      kind: "scry",
      toTop: [],
      toBottom: [card1Id as unknown as EntityId],
    };

    drainWithDecision(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, scryResponse);

    // Card sent to bottom is still in library (just at the bottom).
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    expect(lib?.toArray()).toContain(card1Id);
  });
});

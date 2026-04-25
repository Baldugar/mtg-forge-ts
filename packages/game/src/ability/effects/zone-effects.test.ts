// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for zone-change effect handlers: Exile, ReturnToHand, ChangeZone, Sacrifice.
import "./exile.js";
import "./return-to-hand.js";
import "./change-zone.js";
import "./sacrifice.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

// ────────────────────────────────────────────────────────────────────────────
// ExileEffect
// ────────────────────────────────────────────────────────────────────────────

describe("ExileEffect", () => {
  it("exiles a creature — card moves to shared exile zone", () => {
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

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Exile", params: {} },
        cost: { raw: "2 W" },
      },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.sharedZones.exile.contains(creatureId)).toBe(true);
    expect(creature.zone).toBe(ZoneType.Exile);
  });

  it("no-op when targets list is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Exile", params: {} }, cost: { raw: "2 W" } },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    // Should complete without throwing.
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    expect(game.sharedZones.exile.toArray()).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ReturnToHandEffect
// ────────────────────────────────────────────────────────────────────────────

describe("ReturnToHandEffect", () => {
  it("bounces a creature to its owner's hand", () => {
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

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "ReturnToHand", params: {} }, cost: { raw: "1 U" } },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const hand1 = game.getPlayer(seat1).zones.get(ZoneType.Hand);
    expect(hand1?.contains(creatureId)).toBe(true);
    expect(creature.zone).toBe(ZoneType.Hand);
  });

  it("no-op when targets list is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "ReturnToHand", params: {} }, cost: { raw: "1 U" } },
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
// ChangeZoneEffect
// ────────────────────────────────────────────────────────────────────────────

describe("ChangeZoneEffect", () => {
  it("moves a creature to graveyard via Destination$ Graveyard", () => {
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

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChangeZone",
          params: {
            Destination: { kind: "literal", raw: "Graveyard" },
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

    const gy = game.getPlayer(seat1).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(creatureId)).toBe(true);
    expect(creature.zone).toBe(ZoneType.Graveyard);
  });

  it("no-op when Destination$ is missing or unrecognized", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "ChangeZone", params: {} },
        cost: { raw: "1" },
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
// SacrificeEffect
// ────────────────────────────────────────────────────────────────────────────

describe("SacrificeEffect", () => {
  it("sacrifices a creature — moves it to its owner's graveyard", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(creatureId);

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Sacrifice", params: {} }, cost: { raw: "1 B" } },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(creatureId)).toBe(true);
    expect(creature.zone).toBe(ZoneType.Graveyard);
  });

  it("no-op when targets list is empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Sacrifice", params: {} }, cost: { raw: "1 B" } },
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

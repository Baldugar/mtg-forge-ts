// SPDX-License-Identifier: GPL-3.0-or-later
// PutCounterAllEffect tests — board-wide counter addition.
import "./put-counter-all.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
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
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Grizzly Bears",
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
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

const mkAst = (validCards: string, counterType: string, counterNum: number) => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "PutCounterAll",
    params: {
      ValidCards: { kind: "literal" as const, raw: validCards },
      CounterType: { kind: "literal" as const, raw: counterType },
      CounterNum: { kind: "literal" as const, raw: String(counterNum) },
    },
  },
  cost: { raw: "" },
});

describe("PutCounterAllEffect", () => {
  it("adds P1P1 counter to all Creature.YouCtrl (2 creatures)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10);
    const c2 = mkEntityId(11);
    const foe = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c1, new Card(c1, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c2, new Card(c2, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(foe, new Card(foe, paper, seat1, seat1, ZoneType.Battlefield));

    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c2);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(foe);

    const sa = new SpellAbility(mkAst("Creature.YouCtrl", "P1P1", 1), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // c1 and c2 should have 1 P1P1 counter each.
    expect(game.cards.get(c1)?.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
    expect(game.cards.get(c2)?.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
    // foe should NOT have a counter (not controlled by seat0).
    expect(game.cards.get(foe)?.counters.get(CounterType.PlusOnePlusOne)).toBeUndefined();
  });

  it("adds M1M1 counter to all Creatures (all seats)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10);
    const c2 = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c1, new Card(c1, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c2, new Card(c2, paper, seat1, seat1, ZoneType.Battlefield));

    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(c2);

    const sa = new SpellAbility(mkAst("Creature", "M1M1", 1), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(c1)?.counters.get(CounterType.MinusOneMinusOne)).toBe(1);
    expect(game.cards.get(c2)?.counters.get(CounterType.MinusOneMinusOne)).toBe(1);
  });

  it("CounterNum$ 2 adds 2 counters per creature", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c1, new Card(c1, paper, seat0, seat0, ZoneType.Battlefield));

    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);

    const sa = new SpellAbility(mkAst("Creature.YouCtrl", "P1P1", 2), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(c1)?.counters.get(CounterType.PlusOnePlusOne)).toBe(2);
  });

  it("no-op when no matching permanents exist", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    // No creature type seeded — no matches.

    const sa = new SpellAbility(mkAst("Creature", "P1P1", 1), sourceId, seat0, new Map(), []);
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Verifies that GameAction mutators bump the LayerEngine epoch when they
// observe a real state change, and skip the bump on idempotent no-op paths.
// See SP2 §1 — continuous effects depend on timestamp + dependency
// evaluation; the epoch is the primary cache invalidator driving layered-
// value re-derivation.
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
import { GameAction } from "../action/game-action.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
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
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  seedZones(g);
  return g;
};

const addBattlefieldCard = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, grizzlyBears, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("test: missing Battlefield zone");
  z.add(id);
  return card;
};

const drain = (gen: Generator<unknown, void, unknown>): void => {
  for (const _ of gen) {
    // no-op
  }
};

describe("Epoch bumping integration (SP2 §1)", () => {
  it("addCounter bumps epoch", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(300);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    const before = g.layerEngine.currentEpoch;
    drain(action.addCounter(cid, CounterType.PlusOnePlusOne, 1));
    expect(g.layerEngine.currentEpoch).toBe(before + 1);
  });

  it("removeCounter bumps epoch", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(301);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    drain(action.addCounter(cid, CounterType.PlusOnePlusOne, 2));
    const afterAdd = g.layerEngine.currentEpoch;
    drain(action.removeCounter(cid, CounterType.PlusOnePlusOne, 1));
    expect(g.layerEngine.currentEpoch).toBe(afterAdd + 1);
  });

  it("removeCounter on absent counter type does NOT bump (no-op)", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(302);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    const before = g.layerEngine.currentEpoch;
    drain(action.removeCounter(cid, CounterType.PlusOnePlusOne, 1));
    expect(g.layerEngine.currentEpoch).toBe(before);
  });

  it("moveTo bumps epoch", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(303);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    const before = g.layerEngine.currentEpoch;
    drain(action.moveTo(cid, ZoneType.Graveyard));
    expect(g.layerEngine.currentEpoch).toBe(before + 1);
  });

  it("tap bumps epoch", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(304);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    const before = g.layerEngine.currentEpoch;
    drain(action.tap(cid));
    expect(g.layerEngine.currentEpoch).toBe(before + 1);
  });

  it("untap bumps epoch", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(305);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    drain(action.tap(cid));
    const afterTap = g.layerEngine.currentEpoch;
    drain(action.untap(cid));
    expect(g.layerEngine.currentEpoch).toBe(afterTap + 1);
  });

  it("tap on already-tapped card does NOT bump (no-op semantics from SP1)", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(306);
    addBattlefieldCard(g, seat, cid);
    const action = new GameAction(g);
    drain(action.tap(cid));
    const afterFirstTap = g.layerEngine.currentEpoch;
    drain(action.tap(cid));
    expect(g.layerEngine.currentEpoch).toBe(afterFirstTap);
  });
});

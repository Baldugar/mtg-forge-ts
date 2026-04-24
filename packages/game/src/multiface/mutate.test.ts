// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 61 — mutate.
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
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
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { mutate } from "./mutate.js";

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

const paper = (name: string): PaperCard => ({
  name,
  edition: "IKO",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

interface Fixture {
  game: Game;
  seat0: PlayerSeat;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, seat0: mkPlayerSeat(0) };
};

const placeOnBf = (game: Game, seat: PlayerSeat, card: Card): void => {
  game.cards.set(card.id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield");
  bf.add(card.id);
};

const drain = <R>(gen: Generator<EngineYield, R, unknown>): { yields: EngineYield[]; result: R } => {
  const yields: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return { yields, result: step.value };
};

describe("mutate", () => {
  it("seeds the pile with [mutator, host] when placeOnTop=true on a fresh host", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(1);
    const mutatorId = mkEntityId(2);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(mutatorId, paper("Mutator"), seat0, seat0, ZoneType.Battlefield));
    drain(mutate(game, hostId, mutatorId, true));
    const host = game.cards.get(hostId);
    expect(host?.mutatedPile).toEqual([mutatorId, hostId]);
  });

  it("seeds the pile with [host, mutator] when placeOnTop=false", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(3);
    const mutatorId = mkEntityId(4);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(mutatorId, paper("Mutator"), seat0, seat0, ZoneType.Battlefield));
    drain(mutate(game, hostId, mutatorId, false));
    const host = game.cards.get(hostId);
    expect(host?.mutatedPile).toEqual([hostId, mutatorId]);
  });

  it("grows the pile on consecutive mutates (top keeps order correct)", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(5);
    const m1 = mkEntityId(6);
    const m2 = mkEntityId(7);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(m1, paper("M1"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(m2, paper("M2"), seat0, seat0, ZoneType.Battlefield));
    drain(mutate(game, hostId, m1, true));
    drain(mutate(game, hostId, m2, true));
    const host = game.cards.get(hostId);
    // Latest mutator with placeOnTop=true sits at index 0.
    expect(host?.mutatedPile).toEqual([m2, m1, hostId]);
  });

  it("sets mutatedInto on the mutator", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(8);
    const mutatorId = mkEntityId(9);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(mutatorId, paper("M"), seat0, seat0, ZoneType.Battlefield));
    drain(mutate(game, hostId, mutatorId, true));
    const mutator = game.cards.get(mutatorId);
    expect(mutator?.mutatedInto).toBe(hostId);
  });

  it("emits an AttachmentChanged event linking the mutator to the host", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(10);
    const mutatorId = mkEntityId(11);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(mutatorId, paper("M"), seat0, seat0, ZoneType.Battlefield));
    const { yields } = drain(mutate(game, hostId, mutatorId, true));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "AttachmentChanged");
    expect(ev).toBeDefined();
    if (ev?.kind === "event" && ev.event.kind === "AttachmentChanged") {
      expect(ev.event.payload.cardId).toBe(mutatorId);
      expect(ev.event.payload.newAttachedTo).toBe(hostId);
    }
  });

  it("bumps the layer-engine epoch", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(12);
    const mutatorId = mkEntityId(13);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(mutatorId, paper("M"), seat0, seat0, ZoneType.Battlefield));
    const before = game.layerEngine.currentEpoch;
    drain(mutate(game, hostId, mutatorId, true));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("throws when host or mutator id is unknown", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(14);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    expect(() => drain(mutate(game, hostId, mkEntityId(999), true))).toThrow(GameStateIntegrityError);
  });

  it("throws when host === mutator", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(15);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    expect(() => drain(mutate(game, hostId, hostId, true))).toThrow(GameStateIntegrityError);
  });
});

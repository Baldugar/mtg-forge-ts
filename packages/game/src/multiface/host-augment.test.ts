// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 61 — host + augment.
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
import { combine } from "./host-augment.js";

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
  edition: "UST",
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

describe("combine (host+augment)", () => {
  it("sets augment.attachedTo to host and host.attachments includes augment", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(1);
    const augId = mkEntityId(2);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(augId, paper("Augment"), seat0, seat0, ZoneType.Battlefield));
    drain(combine(game, hostId, augId));
    const host = game.cards.get(hostId);
    const aug = game.cards.get(augId);
    expect(aug?.attachedTo).toBe(hostId);
    expect(host?.attachments).toContain(augId);
  });

  it("marks the augment card with isAugment=true", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(3);
    const augId = mkEntityId(4);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(augId, paper("Augment"), seat0, seat0, ZoneType.Battlefield));
    drain(combine(game, hostId, augId));
    const aug = game.cards.get(augId);
    expect(aug?.isAugment).toBe(true);
  });

  it("emits AttachmentChanged linking augment to host", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(5);
    const augId = mkEntityId(6);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(augId, paper("Augment"), seat0, seat0, ZoneType.Battlefield));
    const { yields } = drain(combine(game, hostId, augId));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "AttachmentChanged");
    expect(ev).toBeDefined();
    if (ev?.kind === "event" && ev.event.kind === "AttachmentChanged") {
      expect(ev.event.payload.cardId).toBe(augId);
      expect(ev.event.payload.newAttachedTo).toBe(hostId);
    }
  });

  it("bumps the layer-engine epoch", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(7);
    const augId = mkEntityId(8);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(augId, paper("Augment"), seat0, seat0, ZoneType.Battlefield));
    const before = game.layerEngine.currentEpoch;
    drain(combine(game, hostId, augId));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("does not duplicate the augment in host.attachments when called twice", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(9);
    const augId = mkEntityId(10);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(augId, paper("Augment"), seat0, seat0, ZoneType.Battlefield));
    drain(combine(game, hostId, augId));
    drain(combine(game, hostId, augId));
    const host = game.cards.get(hostId);
    expect(host?.attachments.filter((id) => id === augId)).toHaveLength(1);
  });

  it("throws when either card id is unknown", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(11);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    expect(() => drain(combine(game, hostId, mkEntityId(999)))).toThrow(GameStateIntegrityError);
  });

  it("throws when host === augment", () => {
    const { game, seat0 } = mkFixture();
    const hostId = mkEntityId(12);
    placeOnBf(game, seat0, new Card(hostId, paper("Host"), seat0, seat0, ZoneType.Battlefield));
    expect(() => drain(combine(game, hostId, hostId))).toThrow(GameStateIntegrityError);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 60 — meld.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
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
import { GameAction } from "../action/game-action.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import type { Exile } from "../zone/zones/exile.js";
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

const brunaPaper: PaperCard = {
  name: "Bruna, the Fading Light",
  edition: "EMN",
  collectorNumber: "15a",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Bruna, the Fading Light" },
    melded: { name: "Brisela, Voice of Nightmares" },
  },
};

const giselaPaper: PaperCard = {
  name: "Gisela, the Broken Blade",
  edition: "EMN",
  collectorNumber: "28a",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Gisela, the Broken Blade" },
  },
};

interface Fixture {
  game: Game;
  action: GameAction;
  seat0: PlayerSeat;
  seat1: PlayerSeat;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  // SharedZones.exile already initialized by Game constructor.
  return { game, action: new GameAction(game), seat0: mkPlayerSeat(0), seat1: mkPlayerSeat(1) };
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

describe("GameAction.meld", () => {
  it("mints a new melded permanent on the shared controller's battlefield", () => {
    const { game, action, seat0 } = mkFixture();
    const brunaId = mkEntityId(1);
    const giselaId = mkEntityId(2);
    placeOnBf(game, seat0, new Card(brunaId, brunaPaper, seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(giselaId, giselaPaper, seat0, seat0, ZoneType.Battlefield));

    const { result: meldedId } = drain(action.meld(brunaId, giselaId));
    const melded = game.cards.get(meldedId);
    expect(melded).toBeDefined();
    expect(melded?.face).toBe("melded");
    expect(melded?.zone).toBe(ZoneType.Battlefield);
    expect(melded?.controllerSeat).toBe(seat0);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    expect(bf?.contains(meldedId)).toBe(true);
  });

  it("exiles both original cards", () => {
    const { game, action, seat0 } = mkFixture();
    const brunaId = mkEntityId(3);
    const giselaId = mkEntityId(4);
    placeOnBf(game, seat0, new Card(brunaId, brunaPaper, seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(giselaId, giselaPaper, seat0, seat0, ZoneType.Battlefield));
    drain(action.meld(brunaId, giselaId));
    const exile = game.sharedZones.exile as Exile;
    expect(exile.contains(brunaId)).toBe(true);
    expect(exile.contains(giselaId)).toBe(true);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    expect(bf?.contains(brunaId)).toBe(false);
    expect(bf?.contains(giselaId)).toBe(false);
  });

  it("captures sourceIds on the melded card's meldedFrom", () => {
    const { game, action, seat0 } = mkFixture();
    const brunaId = mkEntityId(5);
    const giselaId = mkEntityId(6);
    placeOnBf(game, seat0, new Card(brunaId, brunaPaper, seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(giselaId, giselaPaper, seat0, seat0, ZoneType.Battlefield));
    const { result: meldedId } = drain(action.meld(brunaId, giselaId));
    const melded = game.cards.get(meldedId);
    expect(melded?.meldedFrom).toEqual([brunaId, giselaId]);
  });

  it("emits a Melded event carrying the new id and both sources", () => {
    const { game, action, seat0 } = mkFixture();
    const brunaId = mkEntityId(7);
    const giselaId = mkEntityId(8);
    placeOnBf(game, seat0, new Card(brunaId, brunaPaper, seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(giselaId, giselaPaper, seat0, seat0, ZoneType.Battlefield));
    const { yields, result: meldedId } = drain(action.meld(brunaId, giselaId));
    const meldedEv = yields.find((y) => y.kind === "event" && y.event.kind === "Melded");
    expect(meldedEv).toBeDefined();
    if (meldedEv?.kind === "event" && meldedEv.event.kind === "Melded") {
      expect(meldedEv.event.payload.meldedId).toBe(meldedId);
      expect(meldedEv.event.payload.sourceIds).toEqual([brunaId, giselaId]);
    }
    // Suppress unused-var warning: meldedId is also asserted above.
    void game;
  });

  it("bumps the layer-engine epoch", () => {
    const { game, action, seat0 } = mkFixture();
    const brunaId = mkEntityId(9);
    const giselaId = mkEntityId(10);
    placeOnBf(game, seat0, new Card(brunaId, brunaPaper, seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat0, new Card(giselaId, giselaPaper, seat0, seat0, ZoneType.Battlefield));
    const before = game.layerEngine.currentEpoch;
    drain(action.meld(brunaId, giselaId));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("throws when the two cards have different controllers", () => {
    const { game, action, seat0, seat1 } = mkFixture();
    const brunaId = mkEntityId(11);
    const giselaId = mkEntityId(12);
    placeOnBf(game, seat0, new Card(brunaId, brunaPaper, seat0, seat0, ZoneType.Battlefield));
    placeOnBf(game, seat1, new Card(giselaId, giselaPaper, seat1, seat1, ZoneType.Battlefield));
    expect(() => drain(action.meld(brunaId, giselaId))).toThrow(GameStateIntegrityError);
  });

  it("throws when either card id is unknown", () => {
    const { action } = mkFixture();
    expect(() => drain(action.meld(mkEntityId(998) as EntityId, mkEntityId(999) as EntityId))).toThrow(
      GameStateIntegrityError,
    );
  });
});

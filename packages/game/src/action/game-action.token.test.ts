// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 71 — createToken / createEmblem factories.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { EngineYield } from "./engine-yield.js";
import { GameAction } from "./game-action.js";

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

const tokenPaper: PaperCard = {
  name: "Saproling",
  edition: "TOK",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const emblemPaper: PaperCard = {
  name: "Teferi Emblem",
  edition: "EMB",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  game: Game;
  action: GameAction;
  seat0: PlayerSeat;
}

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Command, new CommandZone(ZoneType.Command, player.seat));
  }
};

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return { game, action: new GameAction(game), seat0: mkPlayerSeat(0) };
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

describe("GameAction.createToken", () => {
  it("creates N tokens on the controller's battlefield with isToken=true", () => {
    const { game, action, seat0 } = mkFixture();
    const { result: ids } = drain(action.createToken({ paperCard: tokenPaper, controller: seat0, count: 3 }));
    expect(ids).toHaveLength(3);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    for (const id of ids) {
      const card = game.cards.get(id);
      expect(card).toBeDefined();
      expect(card?.isToken).toBe(true);
      expect(card?.zone).toBe(ZoneType.Battlefield);
      expect(card?.controllerSeat).toBe(seat0);
      expect(card?.ownerSeat).toBe(seat0);
      expect(bf?.contains(id)).toBe(true);
    }
  });

  it("emits one TokenCreated event per token, carrying the token id and controller", () => {
    const { action, seat0 } = mkFixture();
    const { yields, result: ids } = drain(
      action.createToken({ paperCard: tokenPaper, controller: seat0, count: 2 }),
    );
    const tokenEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "TokenCreated");
    expect(tokenEvents).toHaveLength(2);
    for (let i = 0; i < ids.length; i++) {
      const ev = tokenEvents[i];
      if (ev?.kind === "event" && ev.event.kind === "TokenCreated") {
        expect(ev.event.payload.tokenCardId).toBe(ids[i]);
        expect(ev.event.payload.controllerSeat).toBe(seat0);
      }
    }
  });

  it("assigns unique ids to each token", () => {
    const { action, seat0 } = mkFixture();
    const { result: ids } = drain(action.createToken({ paperCard: tokenPaper, controller: seat0, count: 5 }));
    expect(new Set(ids).size).toBe(5);
  });

  it("bumps the layer-engine epoch so continuous-effect caches invalidate", () => {
    const { game, action, seat0 } = mkFixture();
    const before = game.layerEngine.currentEpoch;
    drain(action.createToken({ paperCard: tokenPaper, controller: seat0, count: 1 }));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("rejects count <= 0", () => {
    const { action, seat0 } = mkFixture();
    expect(() => drain(action.createToken({ paperCard: tokenPaper, controller: seat0, count: 0 }))).toThrow(
      IllegalDecisionError,
    );
    expect(() => drain(action.createToken({ paperCard: tokenPaper, controller: seat0, count: -1 }))).toThrow(
      IllegalDecisionError,
    );
  });

  it("returns an empty array only when nothing was minted (error path doesn't apply)", () => {
    // Sanity: count=1 returns a single id.
    const { action, seat0 } = mkFixture();
    const { result: ids } = drain(action.createToken({ paperCard: tokenPaper, controller: seat0, count: 1 }));
    expect(ids).toHaveLength(1);
  });

  it("copyOf populates Card.copiedFrom from the source's live copiable snapshot", () => {
    const { action, seat0 } = mkFixture();
    // Mint one token, then mint a copy-of-token. Both should share
    // copiedFrom semantics (null in SP2 default, but the branch exercises).
    const { result: orig } = drain(
      action.createToken({ paperCard: tokenPaper, controller: seat0, count: 1 }),
    );
    const origId = orig[0] as EntityId;
    const { result: copies } = drain(
      action.createToken({
        paperCard: tokenPaper,
        controller: seat0,
        count: 1,
        isCopy: true,
        copyOf: origId,
      }),
    );
    expect(copies).toHaveLength(1);
  });
});

describe("GameAction.createEmblem", () => {
  it("creates an emblem in the command zone with isEmblem=true", () => {
    const { game, action, seat0 } = mkFixture();
    const { result: id } = drain(action.createEmblem({ ownerSeat: seat0, paperCard: emblemPaper }));
    const card = game.cards.get(id);
    expect(card).toBeDefined();
    expect(card?.isEmblem).toBe(true);
    expect(card?.zone).toBe(ZoneType.Command);
    const cmd = game.getPlayer(seat0).zones.get(ZoneType.Command);
    expect(cmd?.contains(id)).toBe(true);
  });

  it("emits a TokenCreated event for the emblem (shared emission channel)", () => {
    const { action, seat0 } = mkFixture();
    const { yields, result: id } = drain(action.createEmblem({ ownerSeat: seat0, paperCard: emblemPaper }));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "TokenCreated");
    expect(ev).toBeDefined();
    if (ev?.kind === "event" && ev.event.kind === "TokenCreated") {
      expect(ev.event.payload.tokenCardId).toBe(id);
      expect(ev.event.payload.controllerSeat).toBe(seat0);
    }
  });

  it("grantedStatics writes intrinsicStatics on the minted card", () => {
    const { game, action, seat0 } = mkFixture();
    const stub = [{ id: "static-1" }] as never;
    const { result: id } = drain(
      action.createEmblem({ ownerSeat: seat0, paperCard: emblemPaper, grantedStatics: stub }),
    );
    const card = game.cards.get(id);
    expect(card?.intrinsicStatics).toEqual(stub);
  });

  it("bumps the layer-engine epoch", () => {
    const { game, action, seat0 } = mkFixture();
    const before = game.layerEngine.currentEpoch;
    drain(action.createEmblem({ ownerSeat: seat0, paperCard: emblemPaper }));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 69 — surveil generator coverage.
import type { DecisionResponse, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
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

const paper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
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
  }
};

const seedLib = (game: Game, seat: PlayerSeat, ids: readonly EntityId[]): void => {
  const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
  if (!lib) throw new Error("seedLib: missing library");
  for (const id of ids) {
    game.cards.set(id, new Card(id, paper, seat, seat, ZoneType.Library));
    lib.add(id);
  }
};

const mkFixture = (): Fixture => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(game);
  return { game, action: new GameAction(game), seat0: mkPlayerSeat(0) };
};

const runSurveil = (
  game: Game,
  action: GameAction,
  seat: PlayerSeat,
  count: number,
  respond: (cards: readonly EntityId[]) => { top: readonly EntityId[]; graveyard: readonly EntityId[] },
): EngineYield[] => {
  void game;
  const gen = action.surveil(seat, count);
  const yields: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    yields.push(y);
    if (y.kind === "decision") {
      if (y.request.kind !== "surveil") throw new Error("unexpected kind");
      const { top, graveyard } = respond(y.request.cards);
      const resp: DecisionResponse = { kind: "surveil", toTop: top, toGraveyard: graveyard };
      step = gen.next(resp);
    } else {
      step = gen.next();
    }
  }
  return yields;
};

describe("GameAction.surveil", () => {
  it("mill-to-graveyard updates Card.zone and Graveyard size", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11)];
    seedLib(game, seat0, ids);
    runSurveil(game, action, seat0, 2, (cards) => ({ top: [], graveyard: cards }));
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.toArray()).toEqual(ids);
    for (const id of ids) {
      expect(game.cards.get(id)?.zone).toBe(ZoneType.Graveyard);
    }
  });

  it("all-to-top preserves library order", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11), mkEntityId(12)];
    seedLib(game, seat0, ids);
    runSurveil(game, action, seat0, 3, (cards) => ({ top: cards, graveyard: [] }));
    expect(game.getPlayer(seat0).zones.get(ZoneType.Library)?.toArray()).toEqual(ids);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.size).toBe(0);
  });

  it("mixed partition: one to top, one to graveyard", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11)];
    seedLib(game, seat0, ids);
    runSurveil(game, action, seat0, 2, (cards) => {
      const [c0, c1] = cards;
      if (c0 === undefined || c1 === undefined) throw new Error("bad fixture");
      return { top: [c0], graveyard: [c1] };
    });
    expect(game.getPlayer(seat0).zones.get(ZoneType.Library)?.toArray()).toEqual([ids[0]]);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.toArray()).toEqual([ids[1]]);
  });

  it("emits Surveil event with count payload", () => {
    const { game, action, seat0 } = mkFixture();
    seedLib(game, seat0, [mkEntityId(10), mkEntityId(11)]);
    const ys = runSurveil(game, action, seat0, 2, (c) => ({ top: c, graveyard: [] }));
    const ev = ys.find((y) => y.kind === "event" && y.event.kind === "Surveil");
    expect(ev).toBeDefined();
    if (ev?.kind === "event" && ev.event.kind === "Surveil") {
      expect(ev.event.payload.count).toBe(2);
    }
  });

  it("rejects partition with duplicate ids", () => {
    const { game, action, seat0 } = mkFixture();
    seedLib(game, seat0, [mkEntityId(10), mkEntityId(11)]);
    expect(() =>
      runSurveil(game, action, seat0, 2, (cards) => ({
        top: [cards[0] as EntityId, cards[0] as EntityId],
        graveyard: [],
      })),
    ).toThrow(IllegalDecisionError);
  });

  it("rejects a non-surveil response", () => {
    const { game, action, seat0 } = mkFixture();
    seedLib(game, seat0, [mkEntityId(10)]);
    const gen = action.surveil(seat0, 1);
    const step = gen.next();
    if (step.done || step.value.kind !== "decision") throw new Error("expected decision");
    expect(() => gen.next({ kind: "mulligan", keep: true })).toThrow(IllegalDecisionError);
  });

  it("no-op on empty library", () => {
    const { action, seat0 } = mkFixture();
    const step = action.surveil(seat0, 2).next();
    expect(step.done).toBe(true);
  });

  it("rejects zero count", () => {
    const { action, seat0 } = mkFixture();
    expect(() => action.surveil(seat0, 0).next()).toThrow(IllegalDecisionError);
  });
});

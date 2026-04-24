// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 69 — scry generator coverage.
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

const runScry = (
  game: Game,
  action: GameAction,
  seat: PlayerSeat,
  count: number,
  respond: (cards: readonly EntityId[]) => { top: readonly EntityId[]; bottom: readonly EntityId[] },
): EngineYield[] => {
  void game;
  const gen = action.scry(seat, count);
  const yields: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    yields.push(y);
    if (y.kind === "decision") {
      if (y.request.kind !== "scry") throw new Error("unexpected kind");
      const { top, bottom } = respond(y.request.cards);
      const resp: DecisionResponse = { kind: "scry", toTop: top, toBottom: bottom };
      step = gen.next(resp);
    } else {
      step = gen.next();
    }
  }
  return yields;
};

describe("GameAction.scry", () => {
  it("partitions revealed cards — all top (order preserved)", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11), mkEntityId(12)];
    seedLib(game, seat0, ids);
    runScry(game, action, seat0, 3, (cards) => ({ top: cards, bottom: [] }));
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    // After scry all-to-top, the library is in the same order (cards[0] on top).
    expect(lib?.toArray()).toEqual(ids);
  });

  it("all-to-bottom puts revealed cards at the bottom in response order", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11), mkEntityId(12)];
    const filler = [mkEntityId(20), mkEntityId(21)];
    seedLib(game, seat0, [...ids, ...filler]);
    runScry(game, action, seat0, 3, (cards) => ({ top: [], bottom: cards }));
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    // After scry: filler on top, revealed at the bottom in input order.
    expect(lib?.toArray()).toEqual([...filler, ...ids]);
  });

  it("mixed partition: second card to top, first + third to bottom", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11), mkEntityId(12)];
    seedLib(game, seat0, ids);
    runScry(game, action, seat0, 3, (cards) => {
      const [c0, c1, c2] = cards;
      if (c0 === undefined || c1 === undefined || c2 === undefined) throw new Error("bad fixture");
      return { top: [c1], bottom: [c0, c2] };
    });
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    // After: c1 (on top), then c0, c2 at bottom.
    expect(lib?.toArray()).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("emits a Scry event with count equal to revealed size", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11)];
    seedLib(game, seat0, ids);
    const ys = runScry(game, action, seat0, 2, (c) => ({ top: c, bottom: [] }));
    const scryEvents = ys.filter((y) => y.kind === "event" && y.event.kind === "Scry");
    expect(scryEvents).toHaveLength(1);
    const ev = scryEvents[0];
    if (ev?.kind === "event" && ev.event.kind === "Scry") {
      expect(ev.event.payload.count).toBe(2);
      expect(ev.event.payload.playerSeat).toBe(seat0);
    }
  });

  it("handles short library (count > library size)", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10)];
    seedLib(game, seat0, ids);
    runScry(game, action, seat0, 5, (cards) => {
      expect(cards).toHaveLength(1);
      return { top: cards, bottom: [] };
    });
    expect(game.getPlayer(seat0).zones.get(ZoneType.Library)?.size).toBe(1);
  });

  it("no-op when library is empty (no yields)", () => {
    const { action, seat0 } = mkFixture();
    const gen = action.scry(seat0, 3);
    const step = gen.next();
    expect(step.done).toBe(true);
  });

  it("rejects partitions missing a revealed card", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11)];
    seedLib(game, seat0, ids);
    expect(() =>
      runScry(game, action, seat0, 2, (cards) => ({
        top: [cards[0] as EntityId],
        bottom: [mkEntityId(999)],
      })),
    ).toThrow(IllegalDecisionError);
  });

  it("rejects partitions with duplicate ids", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11)];
    seedLib(game, seat0, ids);
    expect(() =>
      runScry(game, action, seat0, 2, (cards) => ({
        top: [cards[0] as EntityId, cards[0] as EntityId],
        bottom: [],
      })),
    ).toThrow(IllegalDecisionError);
  });

  it("rejects wrong-count partition", () => {
    const { game, action, seat0 } = mkFixture();
    const ids = [mkEntityId(10), mkEntityId(11)];
    seedLib(game, seat0, ids);
    expect(() =>
      runScry(game, action, seat0, 2, (cards) => ({
        top: [cards[0] as EntityId],
        bottom: [],
      })),
    ).toThrow(IllegalDecisionError);
  });

  it("rejects a non-scry response", () => {
    const { game, action, seat0 } = mkFixture();
    seedLib(game, seat0, [mkEntityId(10)]);
    const gen = action.scry(seat0, 1);
    const step = gen.next();
    if (step.done || step.value.kind !== "decision") throw new Error("expected decision");
    expect(() => gen.next({ kind: "mulligan", keep: true })).toThrow(IllegalDecisionError);
  });

  it("rejects negative or zero count", () => {
    const { action, seat0 } = mkFixture();
    expect(() => action.scry(seat0, 0).next()).toThrow(IllegalDecisionError);
    expect(() => action.scry(seat0, -1).next()).toThrow(IllegalDecisionError);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 70 — proliferate generator coverage (CR 701.25).
import type { DecisionResponse, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
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
  name: "Creature",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  game: Game;
  action: GameAction;
  seat0: PlayerSeat;
  seat1: PlayerSeat;
}

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const placeOnBattlefield = (
  game: Game,
  seat: PlayerSeat,
  id: EntityId,
  counters: readonly [CounterType, number][],
): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  for (const [t, n] of counters) card.counters.set(t, n);
  game.cards.set(id, card);
  game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(id);
  return card;
};

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return {
    game,
    action: new GameAction(game),
    seat0: mkPlayerSeat(0),
    seat1: mkPlayerSeat(1),
  };
};

const runProliferate = (
  action: GameAction,
  controller: PlayerSeat,
  respond: (req: {
    eligibleCards: readonly EntityId[];
    eligiblePlayers: readonly PlayerSeat[];
  }) => {
    chosenCards: readonly EntityId[];
    chosenPlayers: readonly PlayerSeat[];
    counterChoices: Readonly<Record<string, string>>;
  },
): EngineYield[] => {
  const gen = action.proliferate(controller);
  const yields: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    yields.push(y);
    if (y.kind === "decision") {
      if (y.request.kind !== "chooseProliferateTargets") {
        throw new Error(`unexpected kind ${y.request.kind}`);
      }
      const r = respond({
        eligibleCards: y.request.eligibleCards,
        eligiblePlayers: y.request.eligiblePlayers,
      });
      const resp: DecisionResponse = {
        kind: "chooseProliferateTargets",
        chosenCards: r.chosenCards,
        chosenPlayers: r.chosenPlayers,
        counterChoices: r.counterChoices,
      };
      step = gen.next(resp);
    } else {
      step = gen.next();
    }
  }
  return yields;
};

describe("GameAction.proliferate", () => {
  it("no-op with no counters anywhere", () => {
    const { action, seat0 } = mkFixture();
    const step = action.proliferate(seat0).next();
    expect(step.done).toBe(true);
  });

  it("adds one counter to a chosen card of its existing kind", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(10);
    placeOnBattlefield(game, seat0, id, [[CounterType.PlusOnePlusOne, 2]]);
    runProliferate(action, seat0, (req) => {
      expect(req.eligibleCards).toContain(id);
      return {
        chosenCards: [id],
        chosenPlayers: [],
        counterChoices: { [`c:${id as unknown as number}`]: CounterType.PlusOnePlusOne },
      };
    });
    expect(game.cards.get(id)?.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
  });

  it("enumerates only cards on the battlefield", () => {
    const { game, action, seat0 } = mkFixture();
    const bfId = mkEntityId(10);
    placeOnBattlefield(game, seat0, bfId, [[CounterType.Charge, 1]]);
    // Card with counters but in graveyard — not eligible.
    const gyId = mkEntityId(20);
    const gyCard = new Card(gyId, paper, seat0, seat0, ZoneType.Graveyard);
    gyCard.counters.set(CounterType.Charge, 1);
    game.cards.set(gyId, gyCard);
    game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(gyId);
    runProliferate(action, seat0, (req) => {
      expect(req.eligibleCards).toEqual([bfId]);
      return { chosenCards: [], chosenPlayers: [], counterChoices: {} };
    });
  });

  it("allows declining all targets (empty chosen arrays)", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(10);
    placeOnBattlefield(game, seat0, id, [[CounterType.PlusOnePlusOne, 1]]);
    runProliferate(action, seat0, () => ({
      chosenCards: [],
      chosenPlayers: [],
      counterChoices: {},
    }));
    expect(game.cards.get(id)?.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
  });

  it("falls back to the card's sole counter kind when counterChoices entry missing", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(10);
    placeOnBattlefield(game, seat0, id, [[CounterType.MinusOneMinusOne, 1]]);
    runProliferate(action, seat0, () => ({
      chosenCards: [id],
      chosenPlayers: [],
      counterChoices: {},
    }));
    expect(game.cards.get(id)?.counters.get(CounterType.MinusOneMinusOne)).toBe(2);
  });

  it("increments a player counter (e.g. poison)", () => {
    const { game, action, seat0 } = mkFixture();
    const player = game.getPlayer(seat0);
    player.counters.set(CounterType.Poison, 3);
    runProliferate(action, seat0, (req) => {
      expect(req.eligiblePlayers).toContain(seat0);
      return {
        chosenCards: [],
        chosenPlayers: [seat0],
        counterChoices: { [`p:${seat0 as unknown as number}`]: CounterType.Poison },
      };
    });
    expect(player.counters.get(CounterType.Poison)).toBe(4);
  });

  it("rejects a chosen card not in eligible set", () => {
    const { game, action, seat0 } = mkFixture();
    const a = mkEntityId(10);
    placeOnBattlefield(game, seat0, a, [[CounterType.PlusOnePlusOne, 1]]);
    const ghost = mkEntityId(999);
    expect(() =>
      runProliferate(action, seat0, () => ({
        chosenCards: [ghost],
        chosenPlayers: [],
        counterChoices: { [`c:${ghost as unknown as number}`]: CounterType.PlusOnePlusOne },
      })),
    ).toThrow(IllegalDecisionError);
  });

  it("rejects a chosen player not in eligible set", () => {
    const { game, action, seat0, seat1 } = mkFixture();
    // Only seat0 has counters.
    game.getPlayer(seat0).counters.set(CounterType.Poison, 1);
    expect(() =>
      runProliferate(action, seat0, () => ({
        chosenCards: [],
        chosenPlayers: [seat1],
        counterChoices: { [`p:${seat1 as unknown as number}`]: CounterType.Poison },
      })),
    ).toThrow(IllegalDecisionError);
  });

  it("rejects a counter kind not present on the card", () => {
    const { game, action, seat0 } = mkFixture();
    const a = mkEntityId(10);
    placeOnBattlefield(game, seat0, a, [[CounterType.PlusOnePlusOne, 1]]);
    expect(() =>
      runProliferate(action, seat0, () => ({
        chosenCards: [a],
        chosenPlayers: [],
        counterChoices: { [`c:${a as unknown as number}`]: CounterType.Charge },
      })),
    ).toThrow(IllegalDecisionError);
  });
});

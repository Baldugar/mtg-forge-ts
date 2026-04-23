// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
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
import { type SetupDecks, setupGame } from "./setup-flow.js";

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

const mkGame = (seed = 1n): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(seed),
  });

// Seed `count` cards into the game registry and return their ids so the
// caller can compose them into a SetupDecks map. zone is a placeholder —
// setupGame moves the cards into Library first, then Hand via drawCards.
const seedCards = (game: Game, seat: PlayerSeat, count: number, startId: number): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    // WHY: freshly minted Cards have zone=Library as the placeholder — the
    // generator rewrites this via drawCards once setup runs.
    game.cards.set(id, new Card(id, paper, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

interface DrainResult {
  readonly events: GameEvent[];
  readonly decisions: number;
}

// Fully drain the setup generator, answering every mulligan decision via the
// supplied lambda. Returns the accumulated events and a decision count so
// individual tests can assert mulligan-loop behavior without repeating the
// drive logic.
const drain = (
  game: Game,
  decks: SetupDecks,
  answerKeep: (mulligansSoFar: number, seat: PlayerSeat) => boolean,
): DrainResult => {
  const gen = setupGame(game, decks);
  const events: GameEvent[] = [];
  let decisions = 0;
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      events.push(y.event);
      step = gen.next();
      continue;
    }
    // decision
    decisions++;
    if (y.request.kind !== "mulligan") {
      throw new Error(`drain: unexpected decision kind ${y.request.kind}`);
    }
    const keep = answerKeep(y.request.mulligansSoFar, y.request.playerSeat);
    const resp: DecisionResponse = { kind: "mulligan", keep };
    step = gen.next(resp);
  }
  return { events, decisions };
};

describe("setupGame", () => {
  it("populates per-player zones for both seats", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    drain(game, decks, () => true);
    for (const player of game.players) {
      expect(player.zones.get(ZoneType.Library)).toBeDefined();
      expect(player.zones.get(ZoneType.Hand)).toBeDefined();
      expect(player.zones.get(ZoneType.Graveyard)).toBeDefined();
      expect(player.zones.get(ZoneType.Battlefield)).toBeDefined();
      expect(player.zones.get(ZoneType.Command)).toBeDefined();
    }
  });

  it("keep-first-hand run emits 14 CardDrawn + 2 MulliganTaken + GameStarted", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    const { events, decisions } = drain(game, decks, () => true);
    expect(decisions).toBe(2);
    expect(events.filter((e) => e.kind === "CardDrawn").length).toBe(14);
    expect(events.filter((e) => e.kind === "MulliganTaken").length).toBe(2);
    const last = events[events.length - 1];
    expect(last?.kind).toBe("GameStarted");
  });

  it("library shuffle is deterministic given the same rng seed", () => {
    const gameA = mkGame(42n);
    const gameB = mkGame(42n);
    const decksA: SetupDecks = {
      0: seedCards(gameA, mkPlayerSeat(0), 20, 0),
      1: seedCards(gameA, mkPlayerSeat(1), 20, 20),
    };
    const decksB: SetupDecks = {
      0: seedCards(gameB, mkPlayerSeat(0), 20, 0),
      1: seedCards(gameB, mkPlayerSeat(1), 20, 20),
    };
    drain(gameA, decksA, () => true);
    drain(gameB, decksB, () => true);
    const libA = gameA.players[0]?.zones.get(ZoneType.Library)?.toArray() ?? [];
    const libB = gameB.players[0]?.zones.get(ZoneType.Library)?.toArray() ?? [];
    expect(libA).toEqual(libB);
    // Different seeds produce a different order.
    const gameC = mkGame(99n);
    const decksC: SetupDecks = {
      0: seedCards(gameC, mkPlayerSeat(0), 20, 0),
      1: seedCards(gameC, mkPlayerSeat(1), 20, 20),
    };
    drain(gameC, decksC, () => true);
    const libC = gameC.players[0]?.zones.get(ZoneType.Library)?.toArray() ?? [];
    expect(libC).not.toEqual(libA);
  });

  it("one mulligan then keep produces 14+14 CardDrawn, MulliganTaken events, and GameStarted", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    // Each seat mulligans once (answers false at mulligansSoFar=0), then keeps.
    const { events, decisions } = drain(game, decks, (n) => n >= 1);
    // 2 decisions per seat (1 reject + 1 keep) = 4 total.
    expect(decisions).toBe(4);
    expect(events.filter((e) => e.kind === "CardDrawn").length).toBe(7 * 4);
    expect(events.filter((e) => e.kind === "MulliganTaken").length).toBe(2);
    expect(events[events.length - 1]?.kind).toBe("GameStarted");
  });

  it("GameStarted payload lists every seat and the first player", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    const { events } = drain(game, decks, () => true);
    const started = events.find((e) => e.kind === "GameStarted");
    expect(started).toBeDefined();
    if (started?.kind === "GameStarted") {
      expect(started.payload.seats).toEqual([mkPlayerSeat(0), mkPlayerSeat(1)]);
      expect(started.payload.firstPlayer).toBe(mkPlayerSeat(0));
    }
  });

  it("after keep, hand size equals startingHandSize", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    drain(game, decks, () => true);
    expect(game.players[0]?.zones.get(ZoneType.Hand)?.size).toBe(7);
    expect(game.players[1]?.zones.get(ZoneType.Hand)?.size).toBe(7);
  });

  it("runs free-mulligan semantics under any rule literal (SP1 deferral)", () => {
    // SP1 accepts any of "london" | "vancouver" | "paris" | "free" on
    // GameRules but runs the free-mulligan flow for all of them and emits
    // MulliganTaken with rule: "free". SP2 will add the bottoming
    // DecisionRequest and branch per rule; see setup-flow.ts module docblock.
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules: { ...rules, mulliganRule: "vancouver" },
      meta,
      rng: new SeededRng(1n),
    });
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 10, 0),
      1: seedCards(game, mkPlayerSeat(1), 10, 10),
    };
    const { events } = drain(game, decks, () => true);
    // Both seats emit a MulliganTaken with rule "free" even though the rule
    // literal was "vancouver" — SP1 free-mulligan semantics, labeled truthfully.
    const taken = events.filter((e) => e.kind === "MulliganTaken");
    expect(taken).toHaveLength(2);
    for (const evt of taken) {
      if (evt.kind !== "MulliganTaken") throw new Error("expected MulliganTaken");
      expect(evt.payload.rule).toBe("free");
    }
  });

  it("emits MulliganTaken with rule 'free' even when GameRules.mulliganRule is 'london'", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    const { events } = drain(game, decks, () => true);
    const taken = events.filter((e) => e.kind === "MulliganTaken");
    for (const evt of taken) {
      if (evt.kind !== "MulliganTaken") throw new Error("expected MulliganTaken");
      expect(evt.payload.rule).toBe("free");
    }
  });

  it("after 1 mulligan, every card's .zone matches its physical zone", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    // First mulligan decision = reject, second = keep. Exercises the reshuffle
    // branch that had the card.zone desync bug.
    drain(game, decks, (n) => n >= 1);
    for (const player of game.players) {
      const lib = player.zones.get(ZoneType.Library);
      const hand = player.zones.get(ZoneType.Hand);
      if (!lib || !hand) throw new Error("test: zones not populated");
      for (const id of lib.toArray()) {
        expect(game.cards.get(id)?.zone).toBe(ZoneType.Library);
      }
      for (const id of hand.toArray()) {
        expect(game.cards.get(id)?.zone).toBe(ZoneType.Hand);
      }
    }
  });

  it("excessive mulligans throws GameStateIntegrityError when a controller loops forever", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    expect(() => drain(game, decks, () => false)).toThrow(GameStateIntegrityError);
    const game2 = mkGame();
    const decks2: SetupDecks = {
      0: seedCards(game2, mkPlayerSeat(0), 60, 0),
      1: seedCards(game2, mkPlayerSeat(1), 60, 60),
    };
    expect(() => drain(game2, decks2, () => false)).toThrow(/excessive mulligans/);
  });
});

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
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
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
// supplied lambda. Handles London's mulliganBottom follow-up by bottoming the
// first N cards from the request's hand. Returns the accumulated events and a
// decision count so individual tests can assert mulligan-loop behavior
// without repeating the drive logic.
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
    decisions++;
    if (y.request.kind === "mulligan") {
      const keep = answerKeep(y.request.mulligansSoFar, y.request.playerSeat);
      const resp: DecisionResponse = { kind: "mulligan", keep };
      step = gen.next(resp);
    } else if (y.request.kind === "mulliganBottom") {
      // Default strategy: bottom the first N cards from the given hand.
      const bottomed = y.request.hand.slice(0, y.request.countToBottom);
      const resp: DecisionResponse = { kind: "mulliganBottom", bottomed };
      step = gen.next(resp);
    } else {
      throw new Error(`drain: unexpected decision kind ${y.request.kind}`);
    }
  }
  return { events, decisions };
};

describe("setupGame", () => {
  it("populates per-player zones for both seats with the correct concrete subclass + owner + type", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    drain(game, decks, () => true);
    for (const player of game.players) {
      const library = player.zones.get(ZoneType.Library);
      const hand = player.zones.get(ZoneType.Hand);
      const graveyard = player.zones.get(ZoneType.Graveyard);
      const battlefield = player.zones.get(ZoneType.Battlefield);
      const command = player.zones.get(ZoneType.Command);
      // Structural assertions: class identity + ownerSeat + type enum value.
      // toBeDefined() only rejects undefined; a wrong subclass (e.g., Hand
      // where Library was expected) would slip through.
      expect(library).toBeInstanceOf(Library);
      expect(library?.type).toBe(ZoneType.Library);
      expect(library?.ownerSeat).toBe(player.seat);
      expect(hand).toBeInstanceOf(Hand);
      expect(hand?.type).toBe(ZoneType.Hand);
      expect(hand?.ownerSeat).toBe(player.seat);
      expect(graveyard).toBeInstanceOf(Graveyard);
      expect(graveyard?.type).toBe(ZoneType.Graveyard);
      expect(graveyard?.ownerSeat).toBe(player.seat);
      expect(graveyard?.size).toBe(0);
      expect(battlefield).toBeInstanceOf(Battlefield);
      expect(battlefield?.type).toBe(ZoneType.Battlefield);
      expect(battlefield?.ownerSeat).toBe(player.seat);
      expect(battlefield?.size).toBe(0);
      expect(command).toBeInstanceOf(CommandZone);
      expect(command?.type).toBe(ZoneType.Command);
      expect(command?.ownerSeat).toBe(player.seat);
      expect(command?.size).toBe(0);
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
    // Under London: 3 decisions per seat (1 reject + 1 keep + 1 bottom) = 6.
    const { events, decisions } = drain(game, decks, (n) => n >= 1);
    expect(decisions).toBe(6);
    expect(events.filter((e) => e.kind === "CardDrawn").length).toBe(7 * 4);
    expect(events.filter((e) => e.kind === "MulliganTaken").length).toBe(2);
    expect(events[events.length - 1]?.kind).toBe("GameStarted");
  });

  it("GameStarted payload lists every seat and the die-rolled first player", () => {
    const game = mkGame();
    // Fix 10: host pre-sets startingPlayer to pin first-player to seat 0 for
    // deterministic assertions (otherwise the setup die-roll picks a seat
    // off the rng stream).
    game.startingPlayer = mkPlayerSeat(0);
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

  it("setup die-roll resolves startingPlayer deterministically per rng seed", () => {
    // Same seed -> same die-roll outcome. Different seed should eventually
    // produce different outcomes (probabilistically; we just assert
    // both runs pick ONE of {seat 0, seat 1} and are reproducible).
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
    expect(gameA.startingPlayer).not.toBeNull();
    expect(gameA.startingPlayer).toBe(gameB.startingPlayer);
    // activePlayer tracks startingPlayer after setup.
    expect(gameA.activePlayer).toBe(gameA.startingPlayer);
  });

  it("host-preset game.startingPlayer survives setup (no die-roll override)", () => {
    const game = mkGame();
    game.startingPlayer = mkPlayerSeat(1);
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 20, 0),
      1: seedCards(game, mkPlayerSeat(1), 20, 20),
    };
    drain(game, decks, () => true);
    expect(game.startingPlayer).toBe(mkPlayerSeat(1));
    expect(game.activePlayer).toBe(mkPlayerSeat(1));
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

  it("emits MulliganTaken with rule 'london' when GameRules.mulliganRule is 'london' and N=0 (no bottoming)", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    // keep immediately → 0 mulligans taken → no bottoming yielded, rule="london".
    const { events } = drain(game, decks, () => true);
    const taken = events.filter((e) => e.kind === "MulliganTaken");
    for (const evt of taken) {
      if (evt.kind !== "MulliganTaken") throw new Error("expected MulliganTaken");
      expect(evt.payload.rule).toBe("london");
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

  it("team assignments from GameRules surface on each Player.teamId", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob],
      rules: { ...rules, teamAssignments: [0, 0] },
      meta,
      rng: new SeededRng(1n),
    });
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    drain(game, decks, () => true);
    expect(game.players[0]?.teamId).toBe(0);
    expect(game.players[1]?.teamId).toBe(0);
  });

  it("team assignments default to seat-equals-team when rules omit teamAssignments", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    drain(game, decks, () => true);
    expect(game.players[0]?.teamId).toBe(0);
    expect(game.players[1]?.teamId).toBe(1);
  });
});

// === Commander assignment tests (SP1 §6.4 + §6.6) ===================

// Separate drain helper for SetupOptions (new shape). Mirrors `drain` including
// the mulliganBottom handling for London.
const drainOpts = (
  game: Game,
  opts: import("./setup-flow.js").SetupOptions,
  answerKeep: (mulligansSoFar: number, seat: PlayerSeat) => boolean,
): DrainResult => {
  const gen = setupGame(game, opts);
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
    decisions++;
    if (y.request.kind === "mulligan") {
      const keep = answerKeep(y.request.mulligansSoFar, y.request.playerSeat);
      const resp: DecisionResponse = { kind: "mulligan", keep };
      step = gen.next(resp);
    } else if (y.request.kind === "mulliganBottom") {
      const bottomed = y.request.hand.slice(0, y.request.countToBottom);
      const resp: DecisionResponse = { kind: "mulliganBottom", bottomed };
      step = gen.next(resp);
    } else {
      throw new Error(`drainOpts: unexpected decision kind ${y.request.kind}`);
    }
  }
  return { events, decisions };
};

describe("setupGame — commander assignment", () => {
  it("single-commander mode: commander card moves from library to command zone", () => {
    const game = mkGame();
    const seat0Ids = seedCards(game, mkPlayerSeat(0), 60, 0);
    const seat1Ids = seedCards(game, mkPlayerSeat(1), 60, 60);
    // Choose the first card in seat 0's deck list as commander.
    const commanderId = seat0Ids[0];
    if (commanderId === undefined) throw new Error("test: expected at least 1 seat-0 card");
    drainOpts(
      game,
      {
        decks: { 0: seat0Ids, 1: seat1Ids },
        commanders: {
          0: { kind: "single", commander: commanderId },
          1: { kind: "none" },
        },
      },
      () => true,
    );
    const cmdZone = game.players[0]?.zones.get(ZoneType.Command);
    const library = game.players[0]?.zones.get(ZoneType.Library);
    expect(cmdZone?.toArray()).toContain(commanderId);
    expect(library?.toArray()).not.toContain(commanderId);
    // Card.zone also updated.
    expect(game.cards.get(commanderId)?.zone).toBe(ZoneType.Command);
  });

  it("partners mode: both commanders end up in the command zone", () => {
    const game = mkGame();
    const seat0Ids = seedCards(game, mkPlayerSeat(0), 60, 0);
    const seat1Ids = seedCards(game, mkPlayerSeat(1), 60, 60);
    const a = seat0Ids[0];
    const b = seat0Ids[1];
    if (a === undefined || b === undefined) throw new Error("test: expected 2 seat-0 cards");
    drainOpts(
      game,
      {
        decks: { 0: seat0Ids, 1: seat1Ids },
        commanders: {
          0: { kind: "partners", a, b },
          1: { kind: "none" },
        },
      },
      () => true,
    );
    const cmdZone = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmdZone?.toArray()).toEqual(expect.arrayContaining([a, b]));
    expect(cmdZone?.size).toBe(2);
  });

  it("background mode: commander + background both end up in command zone", () => {
    const game = mkGame();
    const seat0Ids = seedCards(game, mkPlayerSeat(0), 60, 0);
    const seat1Ids = seedCards(game, mkPlayerSeat(1), 60, 60);
    const commander = seat0Ids[0];
    const background = seat0Ids[1];
    if (commander === undefined || background === undefined) {
      throw new Error("test: expected 2 cards");
    }
    drainOpts(
      game,
      {
        decks: { 0: seat0Ids, 1: seat1Ids },
        commanders: {
          0: { kind: "background", commander, background },
          1: { kind: "none" },
        },
      },
      () => true,
    );
    const cmdZone = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmdZone?.toArray()).toEqual(expect.arrayContaining([commander, background]));
    expect(cmdZone?.size).toBe(2);
  });

  it("oathbreaker mode: planeswalker + signature spell both placed in command zone", () => {
    const game = mkGame();
    const seat0Ids = seedCards(game, mkPlayerSeat(0), 60, 0);
    const seat1Ids = seedCards(game, mkPlayerSeat(1), 60, 60);
    const planeswalker = seat0Ids[0];
    const signatureSpell = seat0Ids[1];
    if (planeswalker === undefined || signatureSpell === undefined) {
      throw new Error("test: expected 2 cards");
    }
    drainOpts(
      game,
      {
        decks: { 0: seat0Ids, 1: seat1Ids },
        commanders: {
          0: { kind: "oathbreaker", planeswalker, signatureSpell },
          1: { kind: "none" },
        },
      },
      () => true,
    );
    const cmdZone = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmdZone?.toArray()).toEqual(expect.arrayContaining([planeswalker, signatureSpell]));
    expect(cmdZone?.size).toBe(2);
  });

  it("kind=none leaves library intact (no commander removed)", () => {
    const game = mkGame();
    const seat0Ids = seedCards(game, mkPlayerSeat(0), 60, 0);
    const seat1Ids = seedCards(game, mkPlayerSeat(1), 60, 60);
    drainOpts(
      game,
      {
        decks: { 0: seat0Ids, 1: seat1Ids },
        commanders: { 0: { kind: "none" }, 1: { kind: "none" } },
      },
      () => true,
    );
    const cmdZone = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmdZone?.size).toBe(0);
  });

  it("commanders removed from library before shuffle — never appear in opening draw", () => {
    const game = mkGame();
    const seat0Ids = seedCards(game, mkPlayerSeat(0), 60, 0);
    const seat1Ids = seedCards(game, mkPlayerSeat(1), 60, 60);
    const commander = seat0Ids[0];
    if (commander === undefined) throw new Error("test: expected commander");
    drainOpts(
      game,
      {
        decks: { 0: seat0Ids, 1: seat1Ids },
        commanders: {
          0: { kind: "single", commander },
          1: { kind: "none" },
        },
      },
      () => true,
    );
    // Hand must not contain the commander (it's in command zone).
    const hand = game.players[0]?.zones.get(ZoneType.Hand);
    expect(hand?.toArray()).not.toContain(commander);
    // Library must not contain the commander either.
    const library = game.players[0]?.zones.get(ZoneType.Library);
    expect(library?.toArray()).not.toContain(commander);
  });

  it("legacy positional SetupDecks call shape still works (backward compatible)", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 60, 0),
      1: seedCards(game, mkPlayerSeat(1), 60, 60),
    };
    // This is the old API. Must still run without error.
    drain(game, decks, () => true);
    expect(game.players[0]?.zones.get(ZoneType.Hand)?.size).toBe(7);
  });
});

describe("setupGame — London mulligan bottoming (CR 103.5)", () => {
  // Helper that drives setup directly and captures both request and response
  // so individual tests can inspect the mulliganBottom yield shape.
  const driveLondon = (
    game: Game,
    decks: SetupDecks,
    keepAfter: number,
    pickBottom: (hand: readonly EntityId[], count: number) => readonly EntityId[],
  ): { requestsSeen: string[]; bottomedByRound: Map<number, readonly EntityId[]> } => {
    const gen = setupGame(game, decks);
    const requestsSeen: string[] = [];
    const bottomedByRound = new Map<number, readonly EntityId[]>();
    let round = 0;
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event") {
        step = gen.next();
        continue;
      }
      requestsSeen.push(y.request.kind);
      if (y.request.kind === "mulligan") {
        const keep = y.request.mulligansSoFar >= keepAfter;
        step = gen.next({ kind: "mulligan", keep });
      } else if (y.request.kind === "mulliganBottom") {
        const bottomed = pickBottom(y.request.hand, y.request.countToBottom);
        bottomedByRound.set(round++, bottomed);
        step = gen.next({ kind: "mulliganBottom", bottomed });
      } else {
        throw new Error(`unexpected decision kind ${y.request.kind}`);
      }
    }
    return { requestsSeen, bottomedByRound };
  };

  it("mulligan once then keep: yields mulliganBottom with countToBottom=1", () => {
    const game = mkGame(); // mulliganRule: "london" by default
    const ids0 = seedCards(game, mkPlayerSeat(0), 60, 0);
    const ids1 = seedCards(game, mkPlayerSeat(1), 60, 60);
    const { requestsSeen, bottomedByRound } = driveLondon(game, { 0: ids0, 1: ids1 }, 1, (hand, count) =>
      hand.slice(0, count),
    );
    // Expect 2 mulligan requests (reject + keep) + 1 mulliganBottom per seat = 6.
    const mulliganCount = requestsSeen.filter((k) => k === "mulligan").length;
    const bottomCount = requestsSeen.filter((k) => k === "mulliganBottom").length;
    expect(mulliganCount).toBe(4); // 2 per seat
    expect(bottomCount).toBe(2); // 1 per seat (keeps at N=1)
    // Each bottomed set has length 1.
    for (const arr of bottomedByRound.values()) {
      expect(arr).toHaveLength(1);
    }
  });

  it("bottomed card ends up at the bottom of library, not shuffled", () => {
    const game = mkGame();
    const ids0 = seedCards(game, mkPlayerSeat(0), 60, 0);
    const ids1 = seedCards(game, mkPlayerSeat(1), 60, 60);
    // Track the bottomed card for seat 0 so we can check library bottom.
    let seat0Bottomed: EntityId | null = null;
    const gen = setupGame(game, { 0: ids0, 1: ids1 });
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event") {
        step = gen.next();
        continue;
      }
      if (y.request.kind === "mulligan") {
        const keep = y.request.mulligansSoFar >= 1;
        step = gen.next({ kind: "mulligan", keep });
      } else if (y.request.kind === "mulliganBottom") {
        const chosen = y.request.hand[0];
        if (chosen === undefined) throw new Error("hand unexpectedly empty");
        if (y.request.playerSeat === mkPlayerSeat(0)) seat0Bottomed = chosen;
        step = gen.next({ kind: "mulliganBottom", bottomed: [chosen] });
      } else {
        throw new Error(`unexpected decision kind ${y.request.kind}`);
      }
    }
    if (seat0Bottomed === null) throw new Error("expected a bottomed card for seat 0");
    // After setup, seat 0's library bottom (index size-1) should be the
    // card we bottomed. Library count after 1 bottom: 60 - 6 in hand = 54.
    const lib = game.players[0]?.zones.get(ZoneType.Library);
    expect(lib?.size).toBe(54);
    expect(lib?.toArray()[lib.size - 1]).toBe(seat0Bottomed);
  });

  it("throws IllegalDecisionError when bottomed.length !== countToBottom", () => {
    const game = mkGame();
    const ids0 = seedCards(game, mkPlayerSeat(0), 60, 0);
    const ids1 = seedCards(game, mkPlayerSeat(1), 60, 60);
    const gen = setupGame(game, { 0: ids0, 1: ids1 });
    // Drive until we hit the mulliganBottom request, then respond with wrong length.
    let step = gen.next();
    let threw: unknown = null;
    try {
      while (!step.done) {
        const y = step.value;
        if (y.kind === "event") {
          step = gen.next();
          continue;
        }
        if (y.request.kind === "mulligan") {
          const keep = y.request.mulligansSoFar >= 1;
          step = gen.next({ kind: "mulligan", keep });
        } else if (y.request.kind === "mulliganBottom") {
          // Return wrong length (0 instead of 1).
          step = gen.next({ kind: "mulliganBottom", bottomed: [] });
        } else {
          throw new Error(`unexpected decision kind ${y.request.kind}`);
        }
      }
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(Error);
    expect((threw as Error).message).toMatch(/must equal countToBottom/);
  });

  it("throws IllegalDecisionError when bottomed contains an id not in hand", () => {
    const game = mkGame();
    const ids0 = seedCards(game, mkPlayerSeat(0), 60, 0);
    const ids1 = seedCards(game, mkPlayerSeat(1), 60, 60);
    const gen = setupGame(game, { 0: ids0, 1: ids1 });
    let step = gen.next();
    let threw: unknown = null;
    try {
      while (!step.done) {
        const y = step.value;
        if (y.kind === "event") {
          step = gen.next();
          continue;
        }
        if (y.request.kind === "mulligan") {
          const keep = y.request.mulligansSoFar >= 1;
          step = gen.next({ kind: "mulligan", keep });
        } else if (y.request.kind === "mulliganBottom") {
          // Supply an id that's not in the hand.
          step = gen.next({ kind: "mulliganBottom", bottomed: [mkEntityId(9999)] });
        } else {
          throw new Error(`unexpected decision kind ${y.request.kind}`);
        }
      }
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(Error);
    expect((threw as Error).message).toMatch(/not in hand/);
  });

  it("after bottoming, next drawn card is NOT one of the bottomed (top-of-library invariant)", () => {
    // Seat 0 keeps after 2 mulligans, bottoms 2 cards. Then inspect that the
    // library top (index 0) is a different card than what was bottomed.
    const game = mkGame();
    const ids0 = seedCards(game, mkPlayerSeat(0), 60, 0);
    const ids1 = seedCards(game, mkPlayerSeat(1), 60, 60);
    let seat0Bottomed: readonly EntityId[] = [];
    const gen = setupGame(game, { 0: ids0, 1: ids1 });
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event") {
        step = gen.next();
        continue;
      }
      if (y.request.kind === "mulligan") {
        const keep = y.request.mulligansSoFar >= 2;
        step = gen.next({ kind: "mulligan", keep });
      } else if (y.request.kind === "mulliganBottom") {
        const bottomed = y.request.hand.slice(0, y.request.countToBottom);
        if (y.request.playerSeat === mkPlayerSeat(0)) seat0Bottomed = bottomed;
        step = gen.next({ kind: "mulliganBottom", bottomed });
      } else {
        throw new Error(`unexpected decision kind ${y.request.kind}`);
      }
    }
    const lib = game.players[0]?.zones.get(ZoneType.Library);
    expect(lib).toBeDefined();
    if (!lib) return;
    const top = lib.toArray()[0];
    const bottomedSet = new Set(seat0Bottomed);
    expect(top).toBeDefined();
    if (top !== undefined) expect(bottomedSet.has(top)).toBe(false);
  });
});

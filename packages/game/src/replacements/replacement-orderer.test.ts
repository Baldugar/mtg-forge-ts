// SPDX-License-Identifier: GPL-3.0-or-later
// CR 616 replacement-ordering generator tests (SP2 Task 17).
import type {
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { orderReplacements } from "./replacement-orderer.js";

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

const paperCard: PaperCard = {
  name: "Test Creature",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  return new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
};

const mkReplacement = (id: number, sourceCardId: number): ReplacementAbility => ({
  id: mkEntityId(id),
  kind: "replacement",
  sourceCardId: mkEntityId(sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches: () => true,
  apply: (intent) => intent,
  isSelfReplacement: false,
  layer: "other",
});

const damageToPlayer = (seat: PlayerSeat): MutationIntent =>
  ({
    kind: "damage",
    sourceId: mkEntityId(100),
    targetKind: "player",
    targetId: seat,
    amount: 3,
    isCombat: false,
  }) as unknown as MutationIntent;

const lifeChange = (seat: PlayerSeat): MutationIntent =>
  ({
    kind: "lifeChange",
    seat,
    delta: -2,
    cause: "loss",
  }) as unknown as MutationIntent;

const drawCards = (seat: PlayerSeat): MutationIntent =>
  ({
    kind: "drawCards",
    seat,
    count: 1,
  }) as unknown as MutationIntent;

const moveTo = (cardId: EntityId): MutationIntent =>
  ({
    kind: "moveTo",
    cardId,
    toZone: ZoneType.Graveyard,
    toSeat: null,
    cause: "destroy",
  }) as unknown as MutationIntent;

const addCounter = (cardId: EntityId): MutationIntent =>
  ({
    kind: "addCounter",
    cardId,
    counterType: "+1/+1",
    amount: 1,
    sourceId: null,
  }) as unknown as MutationIntent;

// Generic intent with no seat / cardId so the chooser falls through to
// active player.
const damageUnscoped = (): MutationIntent =>
  ({
    kind: "damage",
    sourceId: mkEntityId(100),
    targetKind: "creature",
    targetId: mkEntityId(999), // not registered in game.cards
    amount: 3,
    isCombat: true,
  }) as unknown as MutationIntent;

describe("orderReplacements (CR 616 chooser)", () => {
  it("empty applicable list → returns empty, yields no decision", () => {
    const game = mkGame();
    const gen = orderReplacements([], damageUnscoped(), game);
    const first = gen.next();
    expect(first.done).toBe(true);
    expect(first.value).toEqual([]);
  });

  it("single applicable → returns that one, yields no decision", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const gen = orderReplacements([r1], damageUnscoped(), game);
    const first = gen.next();
    expect(first.done).toBe(true);
    expect(first.value).toEqual([mkEntityId(1)]);
  });

  it("two applicable on damage-to-player → affected player chooses", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], damageToPlayer(mkPlayerSeat(1)), game);
    const first = gen.next();
    expect(first.done).toBe(false);
    const y = first.value as EngineYield;
    expect(y.kind).toBe("decision");
    if (y.kind !== "decision") throw new Error("expected decision");
    expect(y.request.kind).toBe("orderReplacements");
    if (y.request.kind !== "orderReplacements") throw new Error("expected orderReplacements");
    expect(y.request.playerSeat).toBe(mkPlayerSeat(1));
    expect(y.request.replacementIds).toEqual([mkEntityId(1), mkEntityId(2)]);

    const done = gen.next({ order: [mkEntityId(2), mkEntityId(1)] });
    expect(done.done).toBe(true);
    expect(done.value).toEqual([mkEntityId(2), mkEntityId(1)]);
  });

  it("two applicable on lifeChange → that player chooses", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], lifeChange(mkPlayerSeat(0)), game);
    const first = gen.next();
    if (first.done || first.value.kind !== "decision") {
      throw new Error("expected decision yield");
    }
    if (first.value.request.kind !== "orderReplacements") throw new Error("wrong kind");
    expect(first.value.request.playerSeat).toBe(mkPlayerSeat(0));
    gen.next({ order: [mkEntityId(1), mkEntityId(2)] });
  });

  it("two applicable on drawCards → that player chooses", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], drawCards(mkPlayerSeat(1)), game);
    const first = gen.next();
    if (first.done || first.value.kind !== "decision") {
      throw new Error("expected decision yield");
    }
    if (first.value.request.kind !== "orderReplacements") throw new Error("wrong kind");
    expect(first.value.request.playerSeat).toBe(mkPlayerSeat(1));
    gen.next({ order: [mkEntityId(1), mkEntityId(2)] });
  });

  it("two applicable on moveTo → card's controller chooses", () => {
    const game = mkGame();
    const cardId = mkEntityId(50);
    const card = new Card(cardId, paperCard, mkPlayerSeat(1), mkPlayerSeat(1), ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], moveTo(cardId), game);
    const first = gen.next();
    if (first.done || first.value.kind !== "decision") {
      throw new Error("expected decision yield");
    }
    if (first.value.request.kind !== "orderReplacements") throw new Error("wrong kind");
    expect(first.value.request.playerSeat).toBe(mkPlayerSeat(1));
    gen.next({ order: [mkEntityId(1), mkEntityId(2)] });
  });

  it("two applicable on addCounter → card's controller chooses", () => {
    const game = mkGame();
    const cardId = mkEntityId(51);
    const card = new Card(cardId, paperCard, mkPlayerSeat(0), mkPlayerSeat(1), ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], addCounter(cardId), game);
    const first = gen.next();
    if (first.done || first.value.kind !== "decision") {
      throw new Error("expected decision yield");
    }
    if (first.value.request.kind !== "orderReplacements") throw new Error("wrong kind");
    // Controller is seat 1, not owner 0.
    expect(first.value.request.playerSeat).toBe(mkPlayerSeat(1));
    gen.next({ order: [mkEntityId(1), mkEntityId(2)] });
  });

  it("intent with no affected player or registered card → active player chooses", () => {
    const game = mkGame();
    game.activePlayer = mkPlayerSeat(0);
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], damageUnscoped(), game);
    const first = gen.next();
    if (first.done || first.value.kind !== "decision") {
      throw new Error("expected decision yield");
    }
    if (first.value.request.kind !== "orderReplacements") throw new Error("wrong kind");
    expect(first.value.request.playerSeat).toBe(mkPlayerSeat(0));
    gen.next({ order: [mkEntityId(1), mkEntityId(2)] });
  });

  it("invalid response — missing id → throws", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], damageToPlayer(mkPlayerSeat(0)), game);
    gen.next();
    expect(() => gen.next({ order: [mkEntityId(1)] })).toThrow(/invalid response/);
  });

  it("invalid response — duplicate id → throws", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], damageToPlayer(mkPlayerSeat(0)), game);
    gen.next();
    expect(() => gen.next({ order: [mkEntityId(1), mkEntityId(1)] })).toThrow(/invalid response/);
  });

  it("invalid response — id not in applicable → throws", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const gen = orderReplacements([r1, r2], damageToPlayer(mkPlayerSeat(0)), game);
    gen.next();
    expect(() => gen.next({ order: [mkEntityId(1), mkEntityId(99)] })).toThrow(/invalid response/);
  });

  it("valid response (permutation) → returns the supplied order", () => {
    const game = mkGame();
    const r1 = mkReplacement(1, 10);
    const r2 = mkReplacement(2, 11);
    const r3 = mkReplacement(3, 12);
    const gen = orderReplacements([r1, r2, r3], damageToPlayer(mkPlayerSeat(0)), game);
    gen.next();
    const final = gen.next({ order: [mkEntityId(3), mkEntityId(1), mkEntityId(2)] });
    expect(final.done).toBe(true);
    expect(final.value).toEqual([mkEntityId(3), mkEntityId(1), mkEntityId(2)]);
  });
});

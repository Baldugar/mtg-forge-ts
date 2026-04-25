// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 3 — RollDiceEffect tests.
// Verifies that dice rolls use game.rng (deterministic) and emit RollDie events.
import "./roll-dice.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (seed = 42n) => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(seed) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): EngineYield[] => {
  const yields: EngineYield[] = [];
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    r = gen.next();
  }
  return yields;
};

describe("RollDiceEffect — uses game.rng (Wave 3)", () => {
  it("emits a RollDie event with result in [1, sides]", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RollDice",
          params: {
            NumSides: { kind: "literal", raw: "6" },
            NumDice: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rollDieEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "RollDie");
    expect(rollDieEvents).toHaveLength(1);
    const ev = rollDieEvents[0] as Extract<EngineYield, { kind: "event" }>;
    if (ev.event.kind !== "RollDie") throw new Error("expected RollDie");
    expect(ev.event.payload.sides).toBe(6);
    expect(ev.event.payload.result).toBeGreaterThanOrEqual(1);
    expect(ev.event.payload.result).toBeLessThanOrEqual(6);
  });

  it("rolls are deterministic with the same seed", () => {
    const runWithSeed = (seed: bigint) => {
      const game = mkGame(seed);
      const seat0 = mkPlayerSeat(0);
      const sourceId = mkEntityId(10);
      game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
      const sa = new SpellAbility(
        {
          kind: "spell",
          effect: {
            handlerKey: "RollDice",
            params: {
              NumSides: { kind: "literal", raw: "6" },
              NumDice: { kind: "literal", raw: "1" },
            },
          },
          cost: { raw: "" },
        },
        sourceId,
        seat0,
        new Map(),
        [],
      );
      const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
      const ev = yields.find((y) => y.kind === "event" && y.event.kind === "RollDie") as
        | Extract<EngineYield, { kind: "event" }>
        | undefined;
      if (!ev || ev.event.kind !== "RollDie") throw new Error("no RollDie event");
      return ev.event.payload.result;
    };

    const r1 = runWithSeed(99n);
    const r2 = runWithSeed(99n);
    expect(r1).toBe(r2); // same seed → same result
  });

  it("rolling NumDice=2 emits 2 RollDie events", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "RollDice",
          params: {
            NumSides: { kind: "literal", raw: "6" },
            NumDice: { kind: "literal", raw: "2" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rollDieEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "RollDie");
    expect(rollDieEvents).toHaveLength(2);
  });
});

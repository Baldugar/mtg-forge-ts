// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 3 — FlipACoinEffect tests.
// Verifies that coin flips use game.rng (deterministic) and emit FlipCoin events.
import "./flip-a-coin.js";
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

const mkGame = (seed = 1n) => {
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

describe("FlipACoinEffect — uses game.rng (Wave 3)", () => {
  it("emits a FlipCoin event with a boolean result", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "FlipACoin", params: {} },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const flipEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "FlipCoin");
    expect(flipEvents).toHaveLength(1);
    const ev = flipEvents[0] as Extract<EngineYield, { kind: "event" }>;
    if (ev.event.kind !== "FlipCoin") throw new Error("expected FlipCoin");
    expect(typeof ev.event.payload.resultHeads).toBe("boolean");
  });

  it("flip result is deterministic with the same seed", () => {
    const flipWithSeed = (seed: bigint): boolean => {
      const game = mkGame(seed);
      const seat0 = mkPlayerSeat(0);
      const sourceId = mkEntityId(10);
      game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
      const sa = new SpellAbility(
        {
          kind: "spell",
          effect: { handlerKey: "FlipACoin", params: {} },
          cost: { raw: "" },
        },
        sourceId,
        seat0,
        new Map(),
        [],
      );
      const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
      const ev = yields.find((y) => y.kind === "event" && y.event.kind === "FlipCoin") as
        | Extract<EngineYield, { kind: "event" }>
        | undefined;
      if (!ev || ev.event.kind !== "FlipCoin") throw new Error("no FlipCoin");
      return ev.event.payload.resultHeads;
    };

    expect(flipWithSeed(77n)).toBe(flipWithSeed(77n));
    expect(flipWithSeed(88n)).toBe(flipWithSeed(88n));
  });

  it("no-op (no crash) when no sub-abilities are defined", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "FlipACoin", params: {} },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

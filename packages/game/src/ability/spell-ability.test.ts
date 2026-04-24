// SPDX-License-Identifier: GPL-3.0-or-later
import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { effectRegistry } from "./effect-registry.js";
import { SpellAbilityEffect } from "./spell-ability-effect.js";
import { SpellAbility } from "./spell-ability.js";

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

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const fakeDealDamageAst: AbilityAst = {
  kind: "spell",
  effect: {
    handlerKey: "FakeDealDamage",
    params: {
      NumDmg: { kind: "literal", raw: "3" },
    },
  },
  cost: { raw: "R" },
};

afterEach(() => {
  effectRegistry.clear();
});

describe("SpellAbility", () => {
  it("handlerKey delegates to ast.effect.handlerKey", () => {
    const sa = new SpellAbility(fakeDealDamageAst, mkEntityId(1), mkPlayerSeat(0), new Map());
    expect(sa.handlerKey).toBe("FakeDealDamage");
  });

  it("makeResolver drives the registered effect's resolve with sa + game", () => {
    const calledWith: { sa: SpellAbility; game: Game }[] = [];

    class FakeDealDamage extends SpellAbilityEffect {
      static override readonly handlerKey = "FakeDealDamage";
      // biome-ignore lint/correctness/useYield: test stub — pushes to calledWith without yielding
      override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
        calledWith.push({ sa, game });
      }
    }

    effectRegistry.register(FakeDealDamage);
    const game = mkGame();
    const sourceId = mkEntityId(1);
    const seat = mkPlayerSeat(0);
    const card = new Card(sourceId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(sourceId, card);

    const sa = new SpellAbility(fakeDealDamageAst, sourceId, seat, new Map());
    const resolver = sa.makeResolver();
    // Drain the generator
    const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
    let result = gen.next();
    while (!result.done) {
      result = gen.next();
    }

    expect(calledWith).toHaveLength(1);
    expect(calledWith[0]?.sa).toBe(sa);
    expect(calledWith[0]?.game).toBe(game);
  });

  it("makeResolver throws if no effect registered for handlerKey", () => {
    const game = mkGame();
    const sa = new SpellAbility(fakeDealDamageAst, mkEntityId(1), mkPlayerSeat(0), new Map());
    const resolver = sa.makeResolver();
    const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
    expect(() => gen.next()).toThrow("no registered effect for 'FakeDealDamage'");
  });
});

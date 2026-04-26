// SPDX-License-Identifier: GPL-3.0-or-later
// TokenEffect — tests for inline token synthesis (SP3 Part D Wave 3).
// Covers: basic create, multi-count, variable X amount, TokenScript$ guard,
// and defaults when all optional params are omitted.
import "../../svar/selectors/number.js";
import "./token.js";
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
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

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = <T>(gen: Generator<unknown, T, unknown>): T => {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value as T;
};

/** Minimal SpellAbility for TokenEffect tests. */
const mkTokenSa = (game: Game, params: Record<string, string | number>, xValue?: number): SpellAbility => {
  const seat0 = mkPlayerSeat(0);
  const sourceId = game.newEntityId();

  // Build the params map — all values become literal SVarAsts.
  const effectParams: Record<string, { kind: "literal"; raw: string }> = {};
  for (const [k, v] of Object.entries(params)) {
    effectParams[k] = { kind: "literal", raw: String(v) };
  }

  return new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey: "Token", params: effectParams },
      cost: { raw: "1 R" },
    },
    sourceId,
    seat0,
    new Map(),
    [],
    xValue,
  );
};

describe("TokenEffect", () => {
  it("creates a single 3/1 red Elemental token with Haste", () => {
    const game = mkGame();
    const sa = mkTokenSa(game, {
      TokenAmount: "1",
      TokenPower: "3",
      TokenToughness: "1",
      TokenName: "Elemental",
      TokenTypes: "Creature,Elemental",
      TokenColors: "Red",
      TokenKeywords: "Haste",
    });

    const seat0 = mkPlayerSeat(0);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    expect(bf?.size).toBe(0);

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(1);

    // Inspect the card that was added.
    const tokenId = bf?.toArray()[0];
    const token = game.cards.get(tokenId ?? (0 as ReturnType<typeof game.newEntityId>));
    expect(token?.isToken).toBe(true);

    const paperCard = token?.paperCard;
    expect(paperCard?.name).toBe("Elemental");
    expect(paperCard?.definition?.pt?.power).toBe("3");
    expect(paperCard?.definition?.pt?.toughness).toBe("1");
    // Color check — definition.colors should be set.
    expect(paperCard?.definition?.colors).toBeDefined();
    // Keywords — "Haste" should appear in keywords list.
    expect(Array.isArray(paperCard?.definition?.keywords)).toBe(true);
    expect((paperCard?.definition?.keywords as unknown[]).length).toBe(1);
  });

  it("creates multiple tokens when TokenAmount$ is 3", () => {
    const game = mkGame();
    const sa = mkTokenSa(game, {
      TokenAmount: "3",
      TokenPower: "1",
      TokenToughness: "1",
      TokenName: "Soldier",
      TokenTypes: "Creature,Soldier",
      TokenColors: "White",
    });

    const seat0 = mkPlayerSeat(0);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(3);
    for (const id of bf?.toArray() ?? []) {
      expect(game.cards.get(id)?.isToken).toBe(true);
    }
  });

  it("creates 2 tokens when TokenAmount$ is a literal '2' (xValue flow)", () => {
    const game = mkGame();
    const sa = mkTokenSa(
      game,
      {
        TokenAmount: "2",
        TokenPower: "1",
        TokenToughness: "1",
        TokenName: "Beast",
        TokenTypes: "Creature,Beast",
        TokenColors: "Green",
      },
      2,
    );

    const seat0 = mkPlayerSeat(0);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(2);
  });

  it("throws a clear error when TokenScript$ identifier is unknown", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = game.newEntityId();
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Token",
          params: {
            TokenScript: { kind: "literal", raw: "totally_made_up_token_id" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    expect(() => drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>)).toThrow(
      /unknown TokenScript\$/i,
    );
  });

  it("resolves TokenScript$ w_1_1_soldier to a 1/1 white Soldier creature", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = game.newEntityId();
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Token",
          params: {
            TokenScript: { kind: "literal", raw: "w_1_1_soldier" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(1);
    const id = bf?.toArray()[0];
    const card = game.cards.get(id ?? (0 as ReturnType<typeof game.newEntityId>));
    expect(card?.isToken).toBe(true);
    expect(card?.paperCard.name).toBe("Soldier Token");
    expect(card?.paperCard.definition?.pt?.power).toBe("1");
    expect(card?.paperCard.definition?.pt?.toughness).toBe("1");
  });

  it("respects TokenAmount$ alongside TokenScript$ (3 Saproling tokens)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = game.newEntityId();
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Token",
          params: {
            TokenScript: { kind: "literal", raw: "g_1_1_saproling" },
            TokenAmount: { kind: "literal", raw: "3" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(3);
    for (const id of bf?.toArray() ?? []) {
      const card = game.cards.get(id);
      expect(card?.paperCard.name).toBe("Saproling Token");
    }
  });

  it("resolves a non-creature artifact token (c_a_treasure_sac) without PT", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = game.newEntityId();
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Token",
          params: { TokenScript: { kind: "literal", raw: "c_a_treasure_sac" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(1);
    const id = bf?.toArray()[0];
    const card = game.cards.get(id ?? (0 as ReturnType<typeof game.newEntityId>));
    expect(card?.paperCard.name).toBe("Treasure Token");
    // Treasure has no PT.
    expect(card?.paperCard.definition?.pt).toBeUndefined();
  });

  it("defaults to a 0/0 colorless Token named 'Token' when all optional params omitted", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = game.newEntityId();
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Token", params: {} },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(1);
    const id = bf?.toArray()[0];
    const card = game.cards.get(id ?? (0 as ReturnType<typeof game.newEntityId>));
    expect(card?.paperCard.name).toBe("Token");
    expect(card?.paperCard.definition?.pt?.power).toBe("0");
    expect(card?.paperCard.definition?.pt?.toughness).toBe("0");
  });
});

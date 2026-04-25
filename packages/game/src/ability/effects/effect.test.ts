// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for EffectEffect — MVP meta-wrapper that runs SubAbility$ inline.
import "../../svar/selectors/number.js";
// Self-registering side effects.
import "./effect.js";
import "./draw.js";
import "./gain-life.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
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

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("EffectEffect", () => {
  it("with SubAbility$ DBDraw — runs Draw effect inline", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const card1Id = mkEntityId(30);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(card1Id, new Card(card1Id, paper, seat0, seat0, ZoneType.Library));
    game.getPlayer(seat0).zones.get(ZoneType.Library)?.add(card1Id);

    const drawSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ Draw | NumCards$ 1",
      ability: {
        handlerKey: "Draw",
        params: { NumCards: { kind: "literal", raw: "1" } },
      },
    };
    const svars = new Map<string, SVarAst>([["DBDraw", drawSvar]]);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: {
            SubAbility: { kind: "literal", raw: "DBDraw" },
          },
        },
        cost: { raw: "2 U" },
      },
      sourceId,
      seat0,
      svars,
    );

    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const handAfter = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });

  it("without SubAbility$ — no-op, does not throw", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: {},
        },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const lifeBefore = game.getPlayer(seat0).life;
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    // Nothing changed.
    expect(game.getPlayer(seat0).life).toBe(lifeBefore);
  });

  it("with unknown SubAbility$ handler — silent no-op", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // SVar present but its handlerKey ("UnknownHandler") is not registered.
    const unknownSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ UnknownHandler",
      ability: {
        handlerKey: "UnknownHandler",
        params: {},
      },
    };
    const svars = new Map<string, SVarAst>([["DBUnknown", unknownSvar]]);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: {
            SubAbility: { kind: "literal", raw: "DBUnknown" },
          },
        },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      svars,
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

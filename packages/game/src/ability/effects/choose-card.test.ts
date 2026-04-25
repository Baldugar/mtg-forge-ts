// SPDX-License-Identifier: GPL-3.0-or-later
import "./choose-card.js";
import "../../svar/selectors/number.js";
import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
const makePaper = (name: string): PaperCard => ({
  name,
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

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

const mkAst = (choices: string, num?: number): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "ChooseCard",
    params: {
      Choices: { kind: "literal", raw: choices },
      ...(num !== undefined ? { NumChoices: { kind: "literal", raw: String(num) } } : {}),
    },
  },
  cost: { raw: "" },
});

describe("ChooseCardEffect", () => {
  it("picks one card from candidates and stores in source.remembered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const c1 = mkEntityId(20);
    const c2 = mkEntityId(21);
    const c3 = mkEntityId(22);

    const source = new Card(sourceId, makePaper("Source"), seat0, seat0, ZoneType.Battlefield);
    // All three candidates controlled by seat0.
    game.cards.set(sourceId, source);
    game.cards.set(c1, new Card(c1, makePaper("C1"), seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c2, new Card(c2, makePaper("C2"), seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c3, new Card(c3, makePaper("C3"), seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(mkAst("Card.YouCtrl", 1), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Exactly 1 chosen, appended to source.remembered.
    expect(source.remembered).toHaveLength(1);
  });

  it("picks NumChoices$ cards when specified", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, makePaper("Source"), seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    for (let i = 20; i < 25; i++) {
      game.cards.set(
        mkEntityId(i),
        new Card(mkEntityId(i), makePaper(`C${i}`), seat0, seat0, ZoneType.Battlefield),
      );
    }

    const sa = new SpellAbility(mkAst("Card.YouCtrl", 3), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(source.remembered).toHaveLength(3);
  });

  it("chosen ids are valid entity ids present in game.cards", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const c1 = mkEntityId(20);
    const source = new Card(sourceId, makePaper("Source"), seat0, seat0, ZoneType.Battlefield);
    const card1 = new Card(c1, makePaper("Card1"), seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(c1, card1);

    const sa = new SpellAbility(mkAst("Card.YouCtrl", 1), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    for (const id of source.remembered) {
      expect(game.cards.has(id)).toBe(true);
    }
  });
});

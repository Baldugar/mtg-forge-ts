// SPDX-License-Identifier: GPL-3.0-or-later
// ChooseSourceEffect tests — pick a damage source and store in remembered.
import "./choose-source.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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

const mkAst = (choices: string) => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "ChooseSource",
    params: {
      Choices: { kind: "literal" as const, raw: choices },
    },
  },
  cost: { raw: "" },
});

describe("ChooseSourceEffect", () => {
  it("picks one opponent card and stores in source.remembered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const foe1 = mkEntityId(20);
    const foe2 = mkEntityId(21);

    const source = new Card(sourceId, makePaper("Protection Source"), seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(foe1, new Card(foe1, makePaper("Goblin"), seat1, seat1, ZoneType.Battlefield));
    game.cards.set(foe2, new Card(foe2, makePaper("Dragon"), seat1, seat1, ZoneType.Battlefield));

    const sa = new SpellAbility(mkAst("Card.OpponentCtrl"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(source.remembered).toHaveLength(1);
    // The chosen card should be one of the opponent's cards.
    expect([foe1, foe2]).toContain(source.remembered[0]);
  });

  it("no candidates — remembered stays empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const source = new Card(sourceId, makePaper("Protection Source"), seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    // No opponent cards.

    const sa = new SpellAbility(mkAst("Card.OpponentCtrl"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(source.remembered).toHaveLength(0);
  });

  it("chosen id is present in game.cards", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const foe1 = mkEntityId(20);

    const source = new Card(sourceId, makePaper("Source"), seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(foe1, new Card(foe1, makePaper("Foe"), seat1, seat1, ZoneType.Battlefield));

    const sa = new SpellAbility(mkAst("Card.OpponentCtrl"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    for (const id of source.remembered) {
      expect(game.cards.has(id)).toBe(true);
    }
  });
});

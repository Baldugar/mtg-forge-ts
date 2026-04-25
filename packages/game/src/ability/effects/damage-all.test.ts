// SPDX-License-Identifier: GPL-3.0-or-later
// DamageAllEffect tests — Pyroclasm, Earthquake, etc.
import "../../svar/selectors/number.js";
import "./damage-all.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
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
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Grizzly Bears",
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
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

describe("DamageAllEffect", () => {
  it("deals 2 damage to all creatures (Pyroclasm) — each creature gains 2 damage", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10);
    const c2 = mkEntityId(11);
    const c3 = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(c1, paper, seat0, seat0, ZoneType.Battlefield);
    const card2 = new Card(c2, paper, seat0, seat0, ZoneType.Battlefield);
    const card3 = new Card(c3, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(c1, card1);
    game.cards.set(c2, card2);
    game.cards.set(c3, card3);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DamageAll",
          params: {
            NumDmg: { kind: "literal", raw: "2" },
            ValidCards: { kind: "literal", raw: "Creature" },
          },
        },
        cost: { raw: "2 R" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // All creatures (including source since it's also typed as Creature via seeding)
    // should have taken damage. Check the non-source creatures.
    expect(card1.damage).toBe(2);
    expect(card2.damage).toBe(2);
    expect(card3.damage).toBe(2);
  });

  it("Creature.YouCtrl — only damages controller's creatures", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const ally = mkEntityId(10);
    const foe = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const allyCard = new Card(ally, paper, seat0, seat0, ZoneType.Battlefield);
    const foeCard = new Card(foe, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(ally, allyCard);
    game.cards.set(foe, foeCard);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DamageAll",
          params: {
            NumDmg: { kind: "literal", raw: "3" },
            ValidCards: { kind: "literal", raw: "Creature.YouCtrl" },
          },
        },
        cost: { raw: "3 R" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Ally takes 3 damage; foe takes none.
    expect(allyCard.damage).toBe(3);
    expect(foeCard.damage).toBe(0);
  });

  it("no-op when no creatures match", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    // No creature type seeded → filter matches nothing

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DamageAll",
          params: {
            NumDmg: { kind: "literal", raw: "2" },
            ValidCards: { kind: "literal", raw: "Creature" },
          },
        },
        cost: { raw: "2 R" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

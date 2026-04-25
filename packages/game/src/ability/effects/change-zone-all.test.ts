// SPDX-License-Identifier: GPL-3.0-or-later
// ChangeZoneAllEffect tests — mass bounce / mass exile.
import "./change-zone-all.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
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

/** Seed a global Layer 4 "add Creature" type effect. */
const seedCreatureType = (game: Game): void => {
  game.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: 0,
    sourceAbilityId: null,
  });
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("ChangeZoneAllEffect", () => {
  it("bounces 3 creatures to their owners' hands (mass bounce)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10); // owned by seat0
    const c2 = mkEntityId(11); // owned by seat0
    const c3 = mkEntityId(20); // owned by seat1

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(c1, paper, seat0, seat0, ZoneType.Battlefield);
    const card2 = new Card(c2, paper, seat0, seat0, ZoneType.Battlefield);
    const card3 = new Card(c3, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(c1, card1);
    game.cards.set(c2, card2);
    game.cards.set(c3, card3);

    // Add to battlefield zone lists (GameAction.locate requires zone membership).
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c2);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(c3);

    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChangeZoneAll",
          params: {
            ValidCards: { kind: "literal", raw: "Creature" },
            Origin: { kind: "literal", raw: "Battlefield" },
            Destination: { kind: "literal", raw: "Hand" },
          },
        },
        cost: { raw: "4 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // All creatures should now be in their owners' hands.
    expect(card1.zone).toBe(ZoneType.Hand);
    expect(card2.zone).toBe(ZoneType.Hand);
    expect(card3.zone).toBe(ZoneType.Hand);

    // Each returned to their respective owner's hand zone.
    expect(game.getPlayer(seat0).zones.get(ZoneType.Hand)?.contains(c1)).toBe(true);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Hand)?.contains(c2)).toBe(true);
    expect(game.getPlayer(seat1).zones.get(ZoneType.Hand)?.contains(c3)).toBe(true);
  });

  it("mass exile — all matching creatures move to exile", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10);
    const c2 = mkEntityId(11);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const card1 = new Card(c1, paper, seat0, seat0, ZoneType.Battlefield);
    const card2 = new Card(c2, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(c1, card1);
    game.cards.set(c2, card2);

    // Add to zone lists for GameAction.locate.
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c2);

    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChangeZoneAll",
          params: {
            ValidCards: { kind: "literal", raw: "Creature" },
            Origin: { kind: "literal", raw: "Battlefield" },
            Destination: { kind: "literal", raw: "Exile" },
          },
        },
        cost: { raw: "5 U U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(card1.zone).toBe(ZoneType.Exile);
    expect(card2.zone).toBe(ZoneType.Exile);
  });

  it("no-op when Destination$ is missing", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChangeZoneAll",
          params: {
            ValidCards: { kind: "literal", raw: "Creature" },
          },
        },
        cost: { raw: "4 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });

  it("Creature.YouCtrl — only controller's creatures are bounced, opponent's stay", () => {
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
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(ally);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(foe);

    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChangeZoneAll",
          params: {
            ValidCards: { kind: "literal", raw: "Creature.YouCtrl" },
            Origin: { kind: "literal", raw: "Battlefield" },
            Destination: { kind: "literal", raw: "Hand" },
          },
        },
        cost: { raw: "4 U" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(allyCard.zone).toBe(ZoneType.Hand);
    expect(foeCard.zone).toBe(ZoneType.Battlefield);
  });
});

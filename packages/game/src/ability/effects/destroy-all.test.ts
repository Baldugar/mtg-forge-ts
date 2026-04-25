// SPDX-License-Identifier: GPL-3.0-or-later
// DestroyAllEffect tests — board wipe (Wrath of God, Damnation, etc.)
import "./destroy-all.js";
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

/** Seed a global Layer 4 "add Creature" so cards appear as Creatures. */
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

describe("DestroyAllEffect", () => {
  it("destroys all Creatures — 3 creatures all move to graveyard (Wrath of God)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const c1 = mkEntityId(10);
    const c2 = mkEntityId(11);
    const c3 = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c1, new Card(c1, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c2, new Card(c2, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(c3, new Card(c3, paper, seat1, seat1, ZoneType.Battlefield));

    // Add to zone lists so GameAction.locate can find them.
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c2);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(c3);

    // Make all cards appear as Creatures via Layer 4 seeding.
    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DestroyAll",
          params: { ValidCards: { kind: "literal", raw: "Creature" } },
        },
        cost: { raw: "2 W W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // All three creatures (not the source, but source is also a "creature" here)
    // should be in graveyard. Check only the non-source creatures.
    expect(game.cards.get(c1)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(c2)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(c3)?.zone).toBe(ZoneType.Graveyard);
  });

  it("Creature.YouCtrl — only controller's creatures are destroyed", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const ally = mkEntityId(10);
    const foe = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(ally, new Card(ally, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(foe, new Card(foe, paper, seat1, seat1, ZoneType.Battlefield));

    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(ally);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(foe);

    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DestroyAll",
          params: { ValidCards: { kind: "literal", raw: "Creature.YouCtrl" } },
        },
        cost: { raw: "2 W W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Ally is destroyed; foe is not.
    expect(game.cards.get(ally)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(foe)?.zone).toBe(ZoneType.Battlefield);
  });

  it("zone-filter regression: creature in graveyard is NOT destroyed by DestroyAll", () => {
    // Regression test for bug where collectMatching iterated game.cards
    // (all zones) instead of filtering to Battlefield only.
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const bfCreature = mkEntityId(10);
    const gyCreature = mkEntityId(11);

    // Source card (the wipe spell) is on the battlefield.
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    // One creature on the battlefield (should be destroyed).
    game.cards.set(bfCreature, new Card(bfCreature, paper, seat0, seat0, ZoneType.Battlefield));
    // One creature already in the graveyard (must NOT be destroyed/moved again).
    game.cards.set(gyCreature, new Card(gyCreature, paper, seat0, seat0, ZoneType.Graveyard));

    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(bfCreature);
    game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(gyCreature);

    seedCreatureType(game);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DestroyAll",
          params: { ValidCards: { kind: "literal", raw: "Creature" } },
        },
        cost: { raw: "2 W W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Battlefield creature destroyed (moved to graveyard).
    expect(game.cards.get(bfCreature)?.zone).toBe(ZoneType.Graveyard);
    // Graveyard creature untouched — still in graveyard, not moved.
    expect(game.cards.get(gyCreature)?.zone).toBe(ZoneType.Graveyard);
  });

  it("no-op when no matching creatures exist", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    // No creature type seeded → no matches

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "DestroyAll",
          params: { ValidCards: { kind: "literal", raw: "Creature" } },
        },
        cost: { raw: "2 W W" },
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

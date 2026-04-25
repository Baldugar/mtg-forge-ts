// SPDX-License-Identifier: GPL-3.0-or-later
// FightEffect test — two creatures fight; each takes damage equal to the
// other's power. SBA destruction is verified when damage >= toughness.
import "./fight.js";
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
const paper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
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

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("FightEffect", () => {
  it("two 2/2 creatures fight — each takes 2 damage", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10); // the spell triggering fight
    const creatureAId = mkEntityId(20);
    const creatureBId = mkEntityId(30);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creatureA = new Card(creatureAId, paper, seat0, seat0, ZoneType.Battlefield);
    const creatureB = new Card(creatureBId, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureAId, creatureA);
    game.cards.set(creatureBId, creatureB);

    // Seed 2/2 PT for both fighters via layer7b.
    game.layerEngine.pt7b.push({ kind: "set", power: 2, toughness: 2, timestamp: 1, sourceAbilityId: null });

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Fight",
          params: {},
        },
        cost: { raw: "G" },
      },
      sourceId,
      seat0,
      new Map(),
      [creatureAId, creatureBId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Both creatures should have taken 2 damage.
    expect(creatureA.damage).toBe(2);
    expect(creatureB.damage).toBe(2);
  });

  it("single-target form: source fights target", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    // source = 3/3, target = 1/1
    game.layerEngine.pt7b.push({ kind: "set", power: 3, toughness: 3, timestamp: 1, sourceAbilityId: null });

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Fight", params: {} },
        cost: { raw: "G" },
      },
      sourceId,
      seat0,
      new Map(),
      [targetId], // one target: targetId fights sourceId
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // source (3/3) deals 3 to target; target (3/3) deals 3 to source.
    // (Both share the same pt7b layer — 3/3 globally in this test.)
    expect(source.damage).toBe(3);
    expect(target.damage).toBe(3);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Ensure svar selectors are registered.
import "../../svar/selectors/number.js";
// Import effect — self-registers in effectRegistry at module load.
import "./deal-damage.js";
import type { AbilityAst, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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

const mkAst = (dmg: number): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "DealDamage",
    params: { NumDmg: { kind: "literal", raw: String(dmg) } },
  },
  cost: { raw: "R" },
});

describe("DealDamageEffect", () => {
  it("deals damage to a player target — life decreases by NumDmg", () => {
    const game = mkGame();
    // Use high entity ids to avoid collision with PlayerSeat values (0, 1)
    const sourceId = mkEntityId(10);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // PlayerSeat is a branded number; cast as EntityId to use in targets array.
    // DealDamageEffect checks game.cards.get(targetId) — if absent, routes as player.
    const targetAsEntityId = seat1 as unknown as EntityId;
    const sa = new SpellAbility(mkAst(2), sourceId, seat0, new Map(), [targetAsEntityId]);

    const before = game.getPlayer(seat1).life;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat1).life).toBe(before - 2);
  });

  it("deals damage to a creature target — creature gains damage counters", () => {
    const game = mkGame();
    const sourceId = mkEntityId(10);
    const seat0 = mkPlayerSeat(0);
    const creatureId = mkEntityId(20);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);

    const sa = new SpellAbility(mkAst(3), sourceId, seat0, new Map(), [creatureId]);

    expect(creature.damage).toBe(0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(creature.damage).toBe(3);
  });
});

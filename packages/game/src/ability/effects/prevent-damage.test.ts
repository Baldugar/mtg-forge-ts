// SPDX-License-Identifier: GPL-3.0-or-later
import "./prevent-damage.js";
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

const mkAst = (amount: number, validTarget?: string): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "PreventDamage",
    params: {
      Amount: { kind: "literal", raw: String(amount) },
      ...(validTarget !== undefined ? { ValidTarget: { kind: "literal", raw: validTarget } } : {}),
    },
  },
  cost: { raw: "" },
});

describe("PreventDamageEffect", () => {
  it("adds Amount$ to controller's damagePreventionShield when ValidTarget$ is You", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(mkAst(3, "You"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.getPlayer(seat0).damagePreventionShield).toBe(3);
  });

  it("defaults to controller when ValidTarget$ is absent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(mkAst(5), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.getPlayer(seat0).damagePreventionShield).toBe(5);
  });

  it("targets opponent when ValidTarget$ is Opponent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(mkAst(4, "Opponent"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.getPlayer(seat1).damagePreventionShield).toBe(4);
    expect(game.getPlayer(seat0).damagePreventionShield).toBe(0);
  });

  it("accumulates shield on repeated applications", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(mkAst(3), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.getPlayer(seat0).damagePreventionShield).toBe(6);
  });
});

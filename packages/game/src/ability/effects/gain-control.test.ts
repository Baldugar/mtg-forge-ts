// SPDX-License-Identifier: GPL-3.0-or-later
import "./gain-control.js";
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

const mkAst = (): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "GainControl",
    params: {},
  },
  cost: { raw: "" },
});

describe("GainControlEffect", () => {
  it("changes controller of target creature to caster's seat", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    // Target is originally controlled by opponent (seat1).
    const target = new Card(targetId, paper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(mkAst(), sourceId, seat0, new Map(), [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(targetId)?.controllerSeat).toBe(seat0);
  });

  it("no-ops when target card is not tracked", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const bogusId = mkEntityId(99);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(mkAst(), sourceId, seat0, new Map(), [bogusId]);
    // changeControl throws GameStateIntegrityError for unknown card.
    // For no-target edge case we expect an error — targets are validated upstream.
    expect(() => drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>)).toThrow();
  });
});

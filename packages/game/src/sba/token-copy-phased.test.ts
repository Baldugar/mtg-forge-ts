// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

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
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const runSweep = (game: Game): EngineYield[] => {
  const yields: EngineYield[] = [];
  const gen = game.sbaEngine.sweep();
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return yields;
};

describe("token-copy-phased — CR 704.5d/e + 702.26c", () => {
  it("token in graveyard → ceases to exist (removed from cards registry)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    card.isToken = true;
    runSweep(game);
    expect(game.cards.has(id)).toBe(false);
    const gy = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(id)).toBe(false);
  });

  it("token in exile → ceases to exist", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = new Card(id, paper, seat, seat, ZoneType.Exile);
    card.isToken = true;
    game.cards.set(id, card);
    game.sharedZones.exile.add(id);
    runSweep(game);
    expect(game.cards.has(id)).toBe(false);
    expect(game.sharedZones.exile.contains(id)).toBe(false);
  });

  it("token on the battlefield → stays (SBA only triggers in non-battlefield zones)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    card.isToken = true;
    runSweep(game);
    expect(game.cards.has(id)).toBe(true);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("non-token card with copiedFrom in graveyard → copy reverts (copiedFrom cleared)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    const copy: CopiableCharacteristics = {
      name: "CopiedName",
      manaCost: ManaCost.parse(""),
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      types: new Set(),
      supertypes: new Set(),
      subtypes: new Set(),
      colors: ColorSet.empty(),
      colorIndicator: null,
      rulesText: "",
    };
    card.copiedFrom = copy;
    runSweep(game);
    expect(card.copiedFrom).toBeNull();
    expect(game.cards.has(id)).toBe(true); // copy-revert does not remove card
  });

  it("non-token card with copiedFrom on battlefield → stays copied", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Battlefield, id);
    const copy: CopiableCharacteristics = {
      name: "CopiedName",
      manaCost: ManaCost.parse(""),
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      types: new Set(),
      supertypes: new Set(),
      subtypes: new Set(),
      colors: ColorSet.empty(),
      colorIndicator: null,
      rulesText: "",
    };
    card.copiedFrom = copy;
    runSweep(game);
    expect(card.copiedFrom).toBe(copy);
  });

  it("token with copiedFrom in graveyard → token cease-existence wins (card removed)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCard(game, seat, ZoneType.Graveyard, id);
    card.isToken = true;
    card.copiedFrom = {
      name: "X",
      manaCost: ManaCost.parse(""),
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      types: new Set(),
      supertypes: new Set(),
      subtypes: new Set(),
      colors: ColorSet.empty(),
      colorIndicator: null,
      rulesText: "",
    };
    runSweep(game);
    expect(game.cards.has(id)).toBe(false);
  });
});

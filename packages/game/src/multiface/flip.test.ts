// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 59 — flip cards (Kamigawa).
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { GameAction } from "../action/game-action.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { isFlipCard } from "./flip.js";

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

const singleFacePaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const flipPaper: PaperCard = {
  name: "Nezumi Shortfang",
  edition: "BOK",
  collectorNumber: "70",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    flipped: { name: "Stabwhisker the Odious" },
  },
};

interface Fixture {
  game: Game;
  action: GameAction;
  seat0: PlayerSeat;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, action: new GameAction(game), seat0: mkPlayerSeat(0) };
};

describe("isFlipCard", () => {
  it("accepts a paper card with a 'flipped' face slot", () => {
    expect(isFlipCard(flipPaper)).toBe(true);
  });

  it("rejects a single-face card", () => {
    expect(isFlipCard(singleFacePaper)).toBe(false);
  });

  it("rejects a transform DFC (front/back, no flipped)", () => {
    const dfc: PaperCard = {
      ...singleFacePaper,
      faces: { front: { name: "F" }, back: { name: "B" } },
    };
    expect(isFlipCard(dfc)).toBe(false);
  });
});

describe("GameAction.flip", () => {
  it("toggles Card.face from 'default' to 'flipped'", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(1);
    const card = new Card(cardId, flipPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.flip(cardId);
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(card.face).toBe("flipped");
  });

  it("toggles back from 'flipped' to 'default' on a second call", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(2);
    const card = new Card(cardId, flipPaper, seat0, seat0, ZoneType.Battlefield);
    card.face = "flipped";
    game.cards.set(cardId, card);
    const gen = action.flip(cardId);
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(card.face).toBe("default");
  });

  it("emits a Flipped event carrying the card id", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(3);
    const card = new Card(cardId, flipPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.flip(cardId);
    const first = gen.next();
    expect(first.done).toBe(false);
    if (first.value?.kind === "event") {
      expect(first.value.event.kind).toBe("Flipped");
      if (first.value.event.kind === "Flipped") {
        expect(first.value.event.payload.cardId).toBe(cardId);
      }
    }
  });

  it("bumps the layer-engine epoch", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(4);
    const card = new Card(cardId, flipPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const before = game.layerEngine.currentEpoch;
    const gen = action.flip(cardId);
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("throws when the card id is unknown", () => {
    const { action } = mkFixture();
    const gen = action.flip(mkEntityId(999));
    expect(() => gen.next()).toThrow(GameStateIntegrityError);
  });

  it("throws when the card is not a flip card", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(5);
    const card = new Card(cardId, singleFacePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.flip(cardId);
    expect(() => gen.next()).toThrow(GameStateIntegrityError);
  });
});

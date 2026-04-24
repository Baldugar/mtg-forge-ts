// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 59 — transform DFCs.
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
import { isTransformDfc } from "./transform.js";

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

const transformPaper: PaperCard = {
  name: "Delver of Secrets",
  edition: "ISD",
  collectorNumber: "51",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Delver of Secrets" },
    back: { name: "Insectile Aberration" },
  },
};

const mdfcPaper: PaperCard = {
  name: "Malakir Rebirth // Malakir Mire",
  edition: "ZNR",
  collectorNumber: "111",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Malakir Rebirth" },
    back: { name: "Malakir Mire" },
  },
  isModalDfc: true,
};

const singleFacePaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const splitPaper: PaperCard = {
  name: "Fire // Ice",
  edition: "APC",
  collectorNumber: "128",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    L: { name: "Fire" },
    R: { name: "Ice" },
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

describe("isTransformDfc", () => {
  it("accepts a card with front+back faces and no isModalDfc flag", () => {
    expect(isTransformDfc(transformPaper)).toBe(true);
  });

  it("rejects an MDFC (front+back but isModalDfc=true)", () => {
    expect(isTransformDfc(mdfcPaper)).toBe(false);
  });

  it("rejects a single-face card", () => {
    expect(isTransformDfc(singleFacePaper)).toBe(false);
  });

  it("rejects a split card (L/R, no front/back)", () => {
    expect(isTransformDfc(splitPaper)).toBe(false);
  });
});

describe("GameAction.transform", () => {
  it("flips 'default' / 'front' to 'back' on first call", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(1);
    const card = new Card(cardId, transformPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.transform(cardId);
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(card.face).toBe("back");
  });

  it("flips 'back' back to 'front' on a second call", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(2);
    const card = new Card(cardId, transformPaper, seat0, seat0, ZoneType.Battlefield);
    card.face = "back";
    game.cards.set(cardId, card);
    const gen = action.transform(cardId);
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(card.face).toBe("front");
  });

  it("emits a Transformed event carrying toFace=new active face", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(3);
    const card = new Card(cardId, transformPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.transform(cardId);
    const first = gen.next();
    if (first.value?.kind === "event" && first.value.event.kind === "Transformed") {
      expect(first.value.event.payload.cardId).toBe(cardId);
      expect(first.value.event.payload.toFace).toBe("back");
    } else {
      expect.fail("expected Transformed event");
    }
  });

  it("bumps the layer-engine epoch", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(4);
    const card = new Card(cardId, transformPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const before = game.layerEngine.currentEpoch;
    const gen = action.transform(cardId);
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("throws on an unknown card id", () => {
    const { action } = mkFixture();
    const gen = action.transform(mkEntityId(999));
    expect(() => gen.next()).toThrow(GameStateIntegrityError);
  });

  it("throws when the card is an MDFC (not a transform DFC)", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(5);
    const card = new Card(cardId, mdfcPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.transform(cardId);
    expect(() => gen.next()).toThrow(GameStateIntegrityError);
  });

  it("throws on a single-face card", () => {
    const { game, action, seat0 } = mkFixture();
    const cardId = mkEntityId(6);
    const card = new Card(cardId, singleFacePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const gen = action.transform(cardId);
    expect(() => gen.next()).toThrow(GameStateIntegrityError);
  });
});

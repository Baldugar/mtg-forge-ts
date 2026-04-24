// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 60 — adventure cards.
import type { DecisionRequest, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { isAdventureCard } from "./adventure.js";

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

const adventurePaper: PaperCard = {
  name: "Bonecrusher Giant",
  edition: "ELD",
  collectorNumber: "115",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Bonecrusher Giant" },
    adventure: { name: "Stomp" },
  },
};

const singleFacePaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  game: Game;
  seat0: PlayerSeat;
}

const makeGame = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, seat0: mkPlayerSeat(0) };
};

describe("isAdventureCard", () => {
  it("accepts a card with an adventure face", () => {
    expect(isAdventureCard(adventurePaper)).toBe(true);
  });

  it("rejects a single-face card", () => {
    expect(isAdventureCard(singleFacePaper)).toBe(false);
  });

  it("rejects a transform DFC without an adventure face", () => {
    const dfc: PaperCard = {
      ...singleFacePaper,
      faces: { front: { name: "F" }, back: { name: "B" } },
    };
    expect(isAdventureCard(dfc)).toBe(false);
  });
});

describe("CastPipeline.stepChooseFace — adventure card", () => {
  it("yields chooseFace with front/adventure options and records the pick", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(100);
    const card = new Card(cardId, adventurePaper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand");
    hand.add(cardId);

    const gen = game.castPipeline.run({
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    const first = gen.next();
    const y = first.value as EngineYield;
    expect(y.kind).toBe("decision");
    if (y.kind === "decision") {
      const req = y.request as DecisionRequest;
      if (req.kind === "chooseFace") {
        expect(req.options).toEqual(["front", "adventure"]);
      } else {
        expect.fail("expected chooseFace");
      }
    }
    const finished = gen.next({ kind: "chooseFace", face: "adventure" });
    let step = finished;
    while (!step.done) step = gen.next();
    const item = step.value as StackItem;
    expect(item.provenance.faceChosen).toBe("adventure");
    expect(card.face).toBe("adventure");
  });
});

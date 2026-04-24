// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 59 — modal DFC detection + cast-pipeline face choice.
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
import { isModalDfc } from "./modal-dfc.js";

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

describe("isModalDfc", () => {
  it("accepts a paper card with isModalDfc=true", () => {
    expect(isModalDfc(mdfcPaper)).toBe(true);
  });

  it("rejects a transform DFC (front/back, no flag)", () => {
    expect(isModalDfc(transformPaper)).toBe(false);
  });
});

describe("CastPipeline.stepChooseFace — modal DFC", () => {
  it("yields chooseFace with front/back options and mirrors the pick to Card.face", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(100);
    const card = new Card(cardId, mdfcPaper, seat0, seat0, ZoneType.Hand);
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
    expect(first.done).toBe(false);
    const y = first.value as EngineYield;
    expect(y.kind).toBe("decision");
    if (y.kind === "decision") {
      const req = y.request as DecisionRequest;
      if (req.kind === "chooseFace") {
        expect(req.options).toEqual(["front", "back"]);
      } else {
        expect.fail("expected chooseFace");
      }
    }
    const finished = gen.next({ kind: "chooseFace", face: "back" });
    let step = finished;
    while (!step.done) step = gen.next();
    const item = step.value as StackItem;
    expect(item.provenance.faceChosen).toBe("back");
    expect(card.face).toBe("back");
  });
});

describe("CastPipeline.stepChooseFace — transform DFC does NOT yield", () => {
  it("auto-passes stepChooseFace for a transform DFC (no MDFC flag)", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(200);
    const card = new Card(cardId, transformPaper, seat0, seat0, ZoneType.Hand);
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
    // Drain — transform DFCs don't yield chooseFace, so we expect the
    // pipeline to complete with no decisions.
    let step = gen.next();
    let decisionCount = 0;
    while (!step.done) {
      if (step.value?.kind === "decision" && step.value.request.kind === "chooseFace") {
        decisionCount++;
      }
      step = gen.next();
    }
    expect(decisionCount).toBe(0);
    // Card.face stays "default" — transform() is what flips it later.
    expect(card.face).toBe("default");
  });
});

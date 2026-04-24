// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 58 — split cards + aftermath.
import type { DecisionRequest, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { deriveBaseCharacteristics } from "../layers/base-characteristics.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { combinedSplitCharacteristics, isAftermathCard, isSplitCard } from "./split.js";

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
  name: "Lightning Bolt",
  edition: "LEA",
  collectorNumber: "161",
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

const aftermathPaper: PaperCard = {
  name: "Driven // Despair",
  edition: "AKH",
  collectorNumber: "219",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    L: { name: "Driven" },
    R: { name: "Despair", subtypes: new Set(["Aftermath"]) },
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
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, seat0: mkPlayerSeat(0) };
};

describe("isSplitCard", () => {
  it("recognizes a paper card with L and R faces", () => {
    expect(isSplitCard(splitPaper)).toBe(true);
  });

  it("rejects a single-face paper card", () => {
    expect(isSplitCard(singleFacePaper)).toBe(false);
  });

  it("rejects a face map that has only one half", () => {
    const onlyL: PaperCard = { ...singleFacePaper, faces: { L: { name: "Only" } } };
    expect(isSplitCard(onlyL)).toBe(false);
  });

  it("rejects a transform-DFC-shaped face map (front/back, no L/R)", () => {
    const dfc: PaperCard = {
      ...singleFacePaper,
      faces: { front: { name: "F" }, back: { name: "B" } },
    };
    expect(isSplitCard(dfc)).toBe(false);
  });
});

describe("isAftermathCard", () => {
  it("accepts a split card whose R face carries the Aftermath subtype", () => {
    expect(isAftermathCard(aftermathPaper)).toBe(true);
  });

  it("rejects a split card whose R face has no Aftermath subtype", () => {
    expect(isAftermathCard(splitPaper)).toBe(false);
  });

  it("rejects a non-split card", () => {
    expect(isAftermathCard(singleFacePaper)).toBe(false);
  });
});

describe("combinedSplitCharacteristics", () => {
  it("joins L and R face names with ' // '", () => {
    const combined = combinedSplitCharacteristics(splitPaper);
    expect(combined.name).toBe("Fire // Ice");
  });

  it("returns empty name when the card has no faces map", () => {
    const combined = combinedSplitCharacteristics(singleFacePaper);
    expect(combined.name).toBe("");
  });
});

describe("deriveBaseCharacteristics — face-aware", () => {
  it("returns paperCard.name for a single-face card (face='default')", () => {
    const card = new Card(mkEntityId(1), singleFacePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Hand);
    const base = deriveBaseCharacteristics(card);
    expect(base.name).toBe("Lightning Bolt");
  });

  it("returns combined 'L // R' name for a split card off-stack (face='default')", () => {
    const card = new Card(mkEntityId(2), splitPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Hand);
    const base = deriveBaseCharacteristics(card);
    expect(base.name).toBe("Fire // Ice");
  });

  it("returns only the L face name when card.face === 'L'", () => {
    const card = new Card(mkEntityId(3), splitPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Stack);
    card.face = "L";
    const base = deriveBaseCharacteristics(card);
    expect(base.name).toBe("Fire");
  });

  it("returns only the R face name when card.face === 'R'", () => {
    const card = new Card(mkEntityId(4), splitPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Stack);
    card.face = "R";
    const base = deriveBaseCharacteristics(card);
    expect(base.name).toBe("Ice");
  });

  it("falls back to paperCard.name when the face key is not in the faces map", () => {
    const card = new Card(mkEntityId(5), singleFacePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Hand);
    card.face = "front"; // not present on single-face card
    const base = deriveBaseCharacteristics(card);
    expect(base.name).toBe("Lightning Bolt");
  });
});

describe("CastPipeline.stepChooseFace — split card", () => {
  it("yields chooseFace and sets Card.face to the chosen half + ctx.faceChosen via provenance", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(100);
    const card = new Card(cardId, splitPaper, seat0, seat0, ZoneType.Hand);
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
      expect(req.kind).toBe("chooseFace");
      if (req.kind === "chooseFace") {
        expect(req.options).toEqual(["L", "R"]);
      }
    }
    const finished = gen.next({ kind: "chooseFace", face: "R" });
    // Drain to completion
    let step = finished;
    while (!step.done) {
      step = gen.next();
    }
    const item = step.value as StackItem;
    expect(item.provenance.faceChosen).toBe("R");
    expect(card.face).toBe("R");
  });
});

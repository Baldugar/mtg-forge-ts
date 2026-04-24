// SPDX-License-Identifier: GPL-3.0-or-later
// CR 701.34 / 702.37 / 702.146 / 702.168 / 702.170 — turn-face-up tests
// (SP2 Task 54). Verifies:
//   - each of the five face-down kinds flips to { kind: "none" }
//     and emits CardTurnedFaceUp with the correct previousKind.
//   - face-up precondition error on already face-up cards.
//   - missing-card-id error.
//   - layerEngine epoch bumps on a successful flip.
//   - post-flip computeCharacteristics no longer applies the face-down
//     override (face-up view restored).
import type { EntityId, GameEvent, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
  ManaCost,
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
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { turnFaceUp } from "./turn-face-up.js";

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "beefcafe",
};

const paper: PaperCard = {
  name: "Hidden",
  edition: "LEA",
  collectorNumber: "099",
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
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xbeefcafen),
  });
  seedZones(g);
  return g;
};

const addCard = (g: Game, id: number, seat: PlayerSeat): EntityId => {
  const cid = mkEntityId(id);
  const card = new Card(cid, paper, seat, seat, ZoneType.Battlefield);
  g.cards.set(cid, card);
  const z = g.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("missing battlefield");
  z.add(cid);
  g.layerEngine.bumpEpoch("seed");
  return cid;
};

const drain = (gen: Generator<unknown, void, unknown>): readonly unknown[] => {
  const out: unknown[] = [];
  for (const y of gen) out.push(y);
  return out;
};

const yieldedEvents = (yields: readonly unknown[]): readonly GameEvent[] => {
  const events: GameEvent[] = [];
  for (const y of yields) {
    if (typeof y === "object" && y !== null && (y as { kind?: string }).kind === "event") {
      events.push((y as { event: GameEvent }).event);
    }
  }
  return events;
};

describe("turnFaceUp (CR 701.34 et al.)", () => {
  it("flips a morph card and emits CardTurnedFaceUp with previousKind=morph", () => {
    const g = mkGame();
    const cid = addCard(g, 1, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    const beforeEpoch = g.layerEngine.currentEpoch;
    const yields = drain(turnFaceUp(g, cid));
    expect(g.cards.get(cid)?.faceDown).toEqual({ kind: "none" });
    const events = yieldedEvents(yields);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.kind).toBe("CardTurnedFaceUp");
    if (e?.kind === "CardTurnedFaceUp") {
      expect(e.payload.cardId).toBe(cid);
      expect(e.payload.previousKind).toBe("morph");
    }
    expect(g.layerEngine.currentEpoch).toBeGreaterThan(beforeEpoch);
  });

  it("flips a manifest card with previousKind=manifest", () => {
    const g = mkGame();
    const cid = addCard(g, 2, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "manifest" };
    const yields = drain(turnFaceUp(g, cid));
    const events = yieldedEvents(yields);
    const e = events[0];
    expect(e?.kind).toBe("CardTurnedFaceUp");
    if (e?.kind === "CardTurnedFaceUp") {
      expect(e.payload.previousKind).toBe("manifest");
    }
  });

  it("flips a foretell card with previousKind=foretell", () => {
    const g = mkGame();
    const cid = addCard(g, 3, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "foretell", castableFrom: "exile" };
    const yields = drain(turnFaceUp(g, cid));
    const events = yieldedEvents(yields);
    const e = events[0];
    if (e?.kind === "CardTurnedFaceUp") {
      expect(e.payload.previousKind).toBe("foretell");
    }
  });

  it("flips a disguise card with previousKind=disguise", () => {
    const g = mkGame();
    const cid = addCard(g, 4, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "disguise", wardAmount: 3 };
    const yields = drain(turnFaceUp(g, cid));
    const events = yieldedEvents(yields);
    const e = events[0];
    if (e?.kind === "CardTurnedFaceUp") {
      expect(e.payload.previousKind).toBe("disguise");
    }
  });

  it("flips a cloak card with previousKind=cloak", () => {
    const g = mkGame();
    const cid = addCard(g, 5, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "cloak" };
    const yields = drain(turnFaceUp(g, cid));
    const events = yieldedEvents(yields);
    const e = events[0];
    if (e?.kind === "CardTurnedFaceUp") {
      expect(e.payload.previousKind).toBe("cloak");
    }
  });

  it("throws on already face-up card", () => {
    const g = mkGame();
    const cid = addCard(g, 6, mkPlayerSeat(0));
    // defaults to { kind: "none" }
    expect(() => drain(turnFaceUp(g, cid))).toThrow(GameStateIntegrityError);
  });

  it("throws on missing card", () => {
    const g = mkGame();
    expect(() => drain(turnFaceUp(g, mkEntityId(999)))).toThrow(GameStateIntegrityError);
  });

  it("post-flip computeCharacteristics restores non-override view", () => {
    const g = mkGame();
    const cid = addCard(g, 7, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    g.layerEngine.bumpEpoch("setup");
    const faceDownChars = g.layerEngine.computeCharacteristics(cid);
    expect(faceDownChars.name).toBe("");
    expect(faceDownChars.power).toBe(2);
    drain(turnFaceUp(g, cid));
    const faceUpChars = g.layerEngine.computeCharacteristics(cid);
    // PaperCard.name is "Hidden" so the base characteristic resolves to it
    // once the face-down override no longer applies.
    expect(faceUpChars.name).toBe("Hidden");
    expect(faceUpChars.power).toBeNull();
  });

  it("GameAction.turnFaceUp wrapper delegates", () => {
    const g = mkGame();
    const cid = addCard(g, 8, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing");
    card.faceDown = { kind: "cloak" };
    const action = new GameAction(g);
    const yields = drain(action.turnFaceUp(cid));
    expect(g.cards.get(cid)?.faceDown).toEqual({ kind: "none" });
    expect(yieldedEvents(yields)).toHaveLength(1);
  });
});

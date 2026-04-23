// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";

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
  seed: "deadbeef",
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const addCard = (g: Game, id: number) => {
  const cid = mkEntityId(id);
  const card = new Card(cid, grizzlyBears, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
  g.cards.set(cid, card);
  return cid;
};

describe("LayerEngine skeleton", () => {
  it("currentEpoch starts at 0", () => {
    const g = mkGame();
    expect(g.layerEngine.currentEpoch).toBe(0);
  });

  it("computeCharacteristics throws GameStateIntegrityError for unknown card id", () => {
    const g = mkGame();
    expect(() => g.layerEngine.computeCharacteristics(mkEntityId(9999))).toThrow(/not found/);
  });

  it("bumpEpoch increments the epoch and clears the cache", () => {
    const g = mkGame();
    const cid = addCard(g, 100);
    g.layerEngine.computeCharacteristics(cid);
    expect(g.layerEngine.getCached(cid)).toBeDefined();
    const e0 = g.layerEngine.currentEpoch;
    g.layerEngine.bumpEpoch("test");
    expect(g.layerEngine.currentEpoch).toBe(e0 + 1);
    expect(g.layerEngine.getCached(cid)).toBeUndefined();
  });

  it("computeCharacteristics caches — two calls in same epoch return same reference", () => {
    const g = mkGame();
    const cid = addCard(g, 101);
    const a = g.layerEngine.computeCharacteristics(cid);
    const b = g.layerEngine.computeCharacteristics(cid);
    expect(a).toBe(b);
  });

  it("cache invalidates on bumpEpoch — new call returns a fresh reference", () => {
    const g = mkGame();
    const cid = addCard(g, 102);
    const a = g.layerEngine.computeCharacteristics(cid);
    g.layerEngine.bumpEpoch("invalidate");
    const b = g.layerEngine.computeCharacteristics(cid);
    expect(a).not.toBe(b);
  });

  it("base characteristics reflect PaperCard.name", () => {
    const g = mkGame();
    const cid = addCard(g, 103);
    const chars = g.layerEngine.computeCharacteristics(cid);
    expect(chars.name).toBe("Grizzly Bears");
  });
});

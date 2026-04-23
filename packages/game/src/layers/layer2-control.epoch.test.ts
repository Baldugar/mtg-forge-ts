// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1b — verify that GameAction.changeControl bumps the LayerEngine
// epoch. This guarantees cached Characteristics are invalidated when control
// changes, so ability-grant statics scoped by controller re-evaluate on the
// next read. See layer2-control.ts module header for the design rationale.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { GameAction } from "../action/game-action.js";
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

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

const addCard = (g: Game, id: number) => {
  const cid = mkEntityId(id);
  const card = new Card(cid, grizzlyBears, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
  g.cards.set(cid, card);
  return cid;
};

// Exhaust the generator — changeControl yields events but we only care about
// the side-effect (state mutation + epoch bump).
const drain = (gen: Generator<unknown, void, unknown>): void => {
  for (const _ of gen) {
    // no-op
  }
};

describe("Layer 2 epoch-bump on changeControl", () => {
  it("changeControl bumps LayerEngine epoch", () => {
    const g = mkGame();
    const cid = addCard(g, 200);
    const action = new GameAction(g);
    const before = g.layerEngine.currentEpoch;
    drain(action.changeControl(cid, mkPlayerSeat(1)));
    expect(g.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("changeControl invalidates cached Characteristics", () => {
    const g = mkGame();
    const cid = addCard(g, 201);
    const action = new GameAction(g);
    const charsBefore = g.layerEngine.computeCharacteristics(cid);
    expect(g.layerEngine.getCached(cid)).toBeDefined();
    drain(action.changeControl(cid, mkPlayerSeat(1)));
    // After the epoch bump the cache was cleared.
    expect(g.layerEngine.getCached(cid)).toBeUndefined();
    // Recompute returns a fresh object (not the same reference as before).
    const charsAfter = g.layerEngine.computeCharacteristics(cid);
    expect(charsAfter).not.toBe(charsBefore);
  });
});

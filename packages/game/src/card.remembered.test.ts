// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 74 — Card.remembered / Card.imprinted snapshot
// round-trip coverage.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { restore, snapshot } from "./snapshot/game-snapshot.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";

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
  name: "Isochron Scepter",
  edition: "MRD",
  collectorNumber: "170",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const g = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of g.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return g;
};

describe("Card.remembered + Card.imprinted snapshot round-trip (Task 74)", () => {
  it("snapshot carries remembered + imprinted lists", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(100);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    card.remembered = [mkEntityId(200), mkEntityId(201)];
    card.imprinted = [mkEntityId(300)];
    game.cards.set(id, card);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(id);
    const snap = snapshot(game);
    const serialized = snap.state.cards.find((c) => c.id === id);
    expect(serialized?.remembered).toEqual([mkEntityId(200), mkEntityId(201)]);
    expect(serialized?.imprinted).toEqual([mkEntityId(300)]);
  });

  it("restore rehydrates remembered + imprinted", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(100);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    card.remembered = [mkEntityId(200), mkEntityId(201)];
    card.imprinted = [mkEntityId(300)];
    game.cards.set(id, card);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(id);
    const snap = snapshot(game);
    const paperMap = new Map([[`${paper.edition}:${paper.collectorNumber}:${paper.language}`, paper]]);
    const restored = restore(snap, {
      lobbyPlayers: [alice, bob],
      rng: new SeededRng(1n),
      paperCards: paperMap,
      rules,
    });
    const rCard = restored.cards.get(id);
    expect(rCard?.remembered).toEqual([mkEntityId(200), mkEntityId(201)]);
    expect(rCard?.imprinted).toEqual([mkEntityId(300)]);
  });

  it("v6 snapshots always carry remembered/imprinted as required fields (post-Task 75)", () => {
    // v6 (Task 75) promoted remembered + imprinted from optional to required
    // on SerializedCard. The v5 "tolerate missing fields" compatibility path
    // no longer applies: legacy v5 snapshots are rejected wholesale at the
    // schemaVersion check in restore(), not piecewise per-field.
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(100);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(id);
    const snap = snapshot(game);
    // A fresh card with no stashed references still has remembered/imprinted
    // present on the wire (empty arrays, not undefined).
    for (const c of snap.state.cards) {
      expect(c.remembered).toEqual([]);
      expect(c.imprinted).toEqual([]);
    }
  });
});

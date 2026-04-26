// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 17b Task C — engine-side emit wiring for LandPlayed + ManaSpent.
//
// LandPlayed: `GameAction.playLand` moves the named land Hand →
// Battlefield, increments `landsPlayedThisTurn`, and emits a `LandPlayed`
// event so the Wave 16 LandPlayedTrigger can fire.
//
// ManaSpent: `CostMana.pay` emits one `ManaSpent` event per distinct
// color spent (bucketed by ManaProduced.color) so the Wave 16
// ManaExpendTrigger can fire on canonical mana payment.
import "../cost/parts/cost-mana.js";
import type { EntityId, GameEvent, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import { CostMana } from "../cost/parts/cost-mana.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { ManaPool } from "../mana/mana-pool.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { EngineYield } from "./engine-yield.js";

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

const samplePaper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
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
    player.manaPool = new ManaPool();
  }
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const addCardToZone = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, samplePaper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

/**
 * Drain a generator, capturing every yielded event. Decision yields are
 * unexpected in these tests (no replacements / decisions on the happy
 * path) and surface as a thrown error.
 */
const drainAndCaptureEvents = <T>(gen: Generator<EngineYield, T, unknown>): readonly GameEvent[] => {
  const events: GameEvent[] = [];
  let r = gen.next();
  while (!r.done) {
    if (r.value.kind === "event") {
      events.push(r.value.event);
      r = gen.next();
    } else {
      throw new Error(`unexpected yield kind: ${r.value.kind}`);
    }
  }
  return events;
};

// ---------------------------------------------------------------------------
// LandPlayed
// ---------------------------------------------------------------------------

describe("GameAction.playLand emits LandPlayed (Wave 17b)", () => {
  it("moves the land to battlefield, increments drop counter, emits LandPlayed", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const landId = mkEntityId(1);
    addCardToZone(game, seat0, ZoneType.Hand, landId);

    expect(game.flags.landsPlayedThisTurn.get(seat0) ?? 0).toBe(0);

    const events = drainAndCaptureEvents(game.action.playLand(landId, seat0));

    // Zone change happened.
    const card = game.cards.get(landId);
    expect(card?.zone).toBe(ZoneType.Battlefield);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.size).toBe(1);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size).toBe(0);

    // Drop counter incremented.
    expect(game.flags.landsPlayedThisTurn.get(seat0)).toBe(1);

    // LandPlayed event present, with cardId + playerSeat.
    const landPlayed = events.find((e) => e.kind === "LandPlayed");
    expect(landPlayed).toBeDefined();
    if (landPlayed && landPlayed.kind === "LandPlayed") {
      expect(landPlayed.payload.cardId).toBe(landId);
      expect(landPlayed.payload.playerSeat).toBe(seat0);
    }

    // LandPlayed comes AFTER the zone-change event (post-state visibility).
    const zoneChangeIdx = events.findIndex((e) => e.kind === "CardChangedZone");
    const landPlayedIdx = events.findIndex((e) => e.kind === "LandPlayed");
    expect(zoneChangeIdx).toBeGreaterThanOrEqual(0);
    expect(landPlayedIdx).toBeGreaterThan(zoneChangeIdx);
  });

  it("throws when card is not in hand", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const landId = mkEntityId(2);
    addCardToZone(game, seat0, ZoneType.Battlefield, landId);
    expect(() => {
      const gen = game.action.playLand(landId, seat0);
      let r = gen.next();
      while (!r.done) r = gen.next();
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ManaSpent
// ---------------------------------------------------------------------------

describe("CostMana.pay emits ManaSpent (Wave 17b)", () => {
  it("emits one ManaSpent event per distinct color, amount = atoms drained", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    addCardToZone(game, seat0, ZoneType.Hand, sourceId);
    const player = game.getPlayer(seat0);
    const pool = player.manaPool as ManaPool;
    // Seed pool: 2 red + 1 green so the cost "1 R G" pays from R/R/G.
    pool.add(ManaProduced.colored(Color.Red, { sourceId }));
    pool.add(ManaProduced.colored(Color.Red, { sourceId }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId }));

    const events = drainAndCaptureEvents(
      CostMana.pay({
        game,
        payerSeat: seat0,
        sourceCardId: sourceId,
        raw: "1 R G",
      }) as Generator<EngineYield, unknown, unknown>,
    );
    const manaSpent = events.filter((e) => e.kind === "ManaSpent");
    expect(manaSpent.length).toBeGreaterThan(0);
    // Two distinct colors spent: Red (2 atoms — one for the colored R pip,
    // one for the generic 1) and Green (1 atom for the colored G pip).
    const buckets: Record<string, number> = {};
    for (const e of manaSpent) {
      if (e.kind !== "ManaSpent") continue;
      const key = e.payload.color === null ? "C" : String(e.payload.color);
      buckets[key] = (buckets[key] ?? 0) + e.payload.amount;
    }
    // Red bucket should be 2; Green bucket should be 1.
    expect(buckets[String(Color.Red)]).toBe(2);
    expect(buckets[String(Color.Green)]).toBe(1);
  });

  it("emits ManaSpent with color=null for a colorless drain", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(11);
    addCardToZone(game, seat0, ZoneType.Hand, sourceId);
    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    pool.add(ManaProduced.colorless({ sourceId }));

    const events = drainAndCaptureEvents(
      CostMana.pay({
        game,
        payerSeat: seat0,
        sourceCardId: sourceId,
        raw: "1",
      }) as Generator<EngineYield, unknown, unknown>,
    );
    const manaSpent = events.filter((e) => e.kind === "ManaSpent");
    expect(manaSpent.length).toBe(1);
    if (manaSpent[0]?.kind === "ManaSpent") {
      expect(manaSpent[0].payload.color).toBeNull();
      expect(manaSpent[0].payload.amount).toBe(1);
      expect(manaSpent[0].payload.playerSeat).toBe(seat0);
    }
  });
});

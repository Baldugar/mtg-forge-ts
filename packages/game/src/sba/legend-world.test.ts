// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  DecisionRequest,
  DecisionResponse,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  Supertype,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

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

const paper = (name: string): PaperCard => ({
  name,
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const addCardNamed = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId, name: string): Card => {
  const card = new Card(id, paper(name), seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

// Make a card's base characteristics include the given supertype.
// Since there's no "becomes supertype" layer effect, we cheat by using
// the layer engine's typeEffects + a parallel hack: supertypes come
// from base characteristics or intrinsic card data. SP2 tolerates a
// test shim that pushes supertypes into the cached Characteristics
// directly by mutating after a compute.
const markSupertype = (game: Game, id: EntityId, supertype: Supertype): void => {
  // WHY no epoch bump: each bump clears the cache for every id, which
  // would discard a prior card's mutated supertype. Mutating the cached
  // chars in place keeps the mutation alive until the next legitimate
  // engine bump.
  const chars = game.layerEngine.computeCharacteristics(id);
  chars.supertypes.add(supertype);
};

const runSweep = (game: Game, responder?: (req: DecisionRequest) => DecisionResponse): EngineYield[] => {
  const yields: EngineYield[] = [];
  const gen = game.sbaEngine.sweep();
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    const y = step.value;
    if (y.kind === "decision") {
      if (!responder) throw new Error("test: decision yielded but no responder");
      step = gen.next(responder(y.request));
    } else {
      step = gen.next();
    }
  }
  return yields;
};

describe("legend-world — CR 704.5j/k", () => {
  it("two legendaries with the same name / same controller → legend rule offers keeper decision", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id1 = mkEntityId(1);
    const id2 = mkEntityId(2);
    const c1 = addCardNamed(game, seat, ZoneType.Battlefield, id1, "Jace");
    const c2 = addCardNamed(game, seat, ZoneType.Battlefield, id2, "Jace");
    markSupertype(game, id1, Supertype.Legendary);
    markSupertype(game, id2, Supertype.Legendary);

    // Keeper is id1 — id2 should move to the graveyard.
    runSweep(game, (req) => {
      if (req.kind !== "chooseLegendKeeper") throw new Error("expected legend decision");
      return { kind: "chooseLegendKeeper", keeperId: id1 };
    });
    expect(c1.zone).toBe(ZoneType.Battlefield);
    expect(c2.zone).toBe(ZoneType.Graveyard);
  });

  it("two legendaries with the same name but different controllers → no legend rule", () => {
    const game = mkGame();
    const id1 = mkEntityId(1);
    const id2 = mkEntityId(2);
    const c1 = addCardNamed(game, mkPlayerSeat(0), ZoneType.Battlefield, id1, "Jace");
    const c2 = addCardNamed(game, mkPlayerSeat(1), ZoneType.Battlefield, id2, "Jace");
    markSupertype(game, id1, Supertype.Legendary);
    markSupertype(game, id2, Supertype.Legendary);
    runSweep(game);
    expect(c1.zone).toBe(ZoneType.Battlefield);
    expect(c2.zone).toBe(ZoneType.Battlefield);
  });

  it("two legendaries with different names, same controller → no legend rule", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id1 = mkEntityId(1);
    const id2 = mkEntityId(2);
    const c1 = addCardNamed(game, seat, ZoneType.Battlefield, id1, "Jace");
    const c2 = addCardNamed(game, seat, ZoneType.Battlefield, id2, "Chandra");
    markSupertype(game, id1, Supertype.Legendary);
    markSupertype(game, id2, Supertype.Legendary);
    runSweep(game);
    expect(c1.zone).toBe(ZoneType.Battlefield);
    expect(c2.zone).toBe(ZoneType.Battlefield);
  });

  it("world rule keeps the newest world permanent (highest entity id)", () => {
    const game = mkGame();
    const id1 = mkEntityId(1);
    const id2 = mkEntityId(5); // newer — larger id
    const c1 = addCardNamed(game, mkPlayerSeat(0), ZoneType.Battlefield, id1, "World A");
    const c2 = addCardNamed(game, mkPlayerSeat(1), ZoneType.Battlefield, id2, "World B");
    markSupertype(game, id1, Supertype.World);
    markSupertype(game, id2, Supertype.World);
    runSweep(game);
    expect(c2.zone).toBe(ZoneType.Battlefield); // newest keeps
    expect(c1.zone).toBe(ZoneType.Graveyard);
  });

  it("single legendary or single world → no SBA fires", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const card = addCardNamed(game, seat, ZoneType.Battlefield, id, "Jace");
    markSupertype(game, id, Supertype.Legendary);
    runSweep(game);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("illegal keeper choice throws IllegalDecisionError", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id1 = mkEntityId(1);
    const id2 = mkEntityId(2);
    addCardNamed(game, seat, ZoneType.Battlefield, id1, "Jace");
    addCardNamed(game, seat, ZoneType.Battlefield, id2, "Jace");
    markSupertype(game, id1, Supertype.Legendary);
    markSupertype(game, id2, Supertype.Legendary);
    expect(() => runSweep(game, () => ({ kind: "chooseLegendKeeper", keeperId: mkEntityId(99) }))).toThrow(
      /not among candidates/,
    );
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone L Task 45 — CR 800.4 removePlayerFromGame tests.
//
// Scenarios covered:
//   - every card owned by the leaving player is removed from game.cards
//     and their zones
//   - cards the leaver controls but does not own return to the owner
//   - stack items controlled by the leaver are dropped
//   - multi-player game: two remaining players, game continues
//   - 3-player loss integration: triggering a PlayerLost SBA fires
//     removePlayerFromGame automatically
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { removePlayerFromGame } from "./leave-game.js";

const mkLobby = (id: string, name: string): LobbyPlayer => ({
  id,
  name,
  controllerKind: id.includes("ai") ? "ai" : "human",
});

const rules3: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 3, max: 3 },
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
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
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

const addCard = (
  game: Game,
  ownerSeat: PlayerSeat,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
  id: EntityId,
): Card => {
  const card = new Card(id, paper, ownerSeat, controllerSeat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(controllerSeat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const mkGame3 = (): Game => {
  const game = new Game({
    lobbyPlayers: [mkLobby("p-0", "Zero"), mkLobby("p-1", "One"), mkLobby("p-2", "Two")],
    rules: rules3,
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(game);
  return game;
};

const runAll = (gen: Generator<EngineYield, unknown, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    out.push(y);
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...y.request.replacementIds] });
    } else {
      step = gen.next();
    }
  }
  return out;
};

describe("removePlayerFromGame (CR 800.4, SP2 Task 45)", () => {
  it("removes every card owned by the leaver from the registry + all zones", () => {
    const game = mkGame3();
    const leaverSeat = mkPlayerSeat(0);
    const aId = mkEntityId(10);
    const bId = mkEntityId(11);
    addCard(game, leaverSeat, leaverSeat, ZoneType.Battlefield, aId);
    addCard(game, leaverSeat, leaverSeat, ZoneType.Hand, bId);
    const foreignerId = mkEntityId(12);
    addCard(game, mkPlayerSeat(1), mkPlayerSeat(1), ZoneType.Battlefield, foreignerId);

    runAll(removePlayerFromGame(game, leaverSeat));

    expect(game.cards.has(aId)).toBe(false);
    expect(game.cards.has(bId)).toBe(false);
    expect(game.cards.has(foreignerId)).toBe(true);
    expect(game.getPlayer(leaverSeat).zones.get(ZoneType.Battlefield)?.contains(aId)).toBe(false);
    expect(game.getPlayer(leaverSeat).zones.get(ZoneType.Hand)?.contains(bId)).toBe(false);
  });

  it("returns control of leaver-controlled but not-owned cards to the original owner", () => {
    const game = mkGame3();
    const leaverSeat = mkPlayerSeat(0);
    const otherOwnerSeat = mkPlayerSeat(1);
    const id = mkEntityId(20);
    // Card owned by seat 1 but currently controlled by seat 0 (stolen).
    // Located in the controller's battlefield for layer-engine consistency.
    addCard(game, otherOwnerSeat, leaverSeat, ZoneType.Battlefield, id);

    runAll(removePlayerFromGame(game, leaverSeat));

    // Card still in registry (owner isn't leaving).
    expect(game.cards.has(id)).toBe(true);
    // Control returned to owner.
    expect(game.cards.get(id)?.controllerSeat).toBe(otherOwnerSeat);
  });

  it("drops stack items controlled by the leaver; leaves non-leaver items alone", () => {
    const game = mkGame3();
    const leaverSeat = mkPlayerSeat(0);
    const otherSeat = mkPlayerSeat(1);
    const mkStackItem = (id: number, sourceId: number, controller: PlayerSeat): StackItem => ({
      id: mkEntityId(id),
      sourceCardId: mkEntityId(sourceId),
      controllerSeat: controller,
      kind: "spell",
      isCast: true,
      targets: null,
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
    });
    const leaverSpell = mkStackItem(100, 101, leaverSeat);
    const otherSpell = mkStackItem(200, 201, otherSeat);
    game.sharedZones.stack.push(leaverSpell);
    game.sharedZones.stack.push(otherSpell);

    runAll(removePlayerFromGame(game, leaverSeat));

    const remaining = game.sharedZones.stack.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(mkEntityId(200));
  });

  it("bumps the layer engine epoch to invalidate post-leave characteristic caches", () => {
    const game = mkGame3();
    const leaverSeat = mkPlayerSeat(0);
    addCard(game, leaverSeat, leaverSeat, ZoneType.Battlefield, mkEntityId(30));
    const before = game.layerEngine.currentEpoch;
    runAll(removePlayerFromGame(game, leaverSeat));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("integration — SBA-driven player loss in a 3-player game fires removePlayerFromGame", () => {
    const game = mkGame3();
    const loserSeat = mkPlayerSeat(2);
    addCard(game, loserSeat, loserSeat, ZoneType.Battlefield, mkEntityId(40));
    addCard(game, loserSeat, loserSeat, ZoneType.Hand, mkEntityId(41));

    // Drive player loss by dropping life to 0.
    game.getPlayer(loserSeat).life = 0;

    runAll(game.sbaEngine.sweep());

    // All of the leaver's cards are out of the registry.
    expect(game.cards.has(mkEntityId(40))).toBe(false);
    expect(game.cards.has(mkEntityId(41))).toBe(false);
    // Audit I-12 — in a 3-player match with 2 players still alive,
    // terminalState is NOT set (the game continues per CR 800.4). Loss is
    // tracked on Game.runningLosses + Player.hasLost instead.
    expect(game.terminalState).toBeNull();
    expect(game.getPlayer(loserSeat).hasLost).toBe(true);
    expect(game.runningLosses?.some((l) => l.seat === loserSeat)).toBe(true);
  });
});

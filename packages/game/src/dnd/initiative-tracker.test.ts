// SPDX-License-Identifier: GPL-3.0-or-later
// Initiative tracker tests — CR 906. Verifies grant + combat-damage
// transfer semantics. The combat-flow integration (CombatHandler hook
// firing) is exercised end-to-end in combat-handler.initiative-monarch
// test alongside Monarch.
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { grantInitiative, onCombatDamageToPlayer } from "./initiative-tracker.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: false,
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

const mkGame = (): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });
  for (const player of g.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return g;
};

describe("InitiativeTracker", () => {
  it("grantInitiative sets the holder + emits BecameInitiative + UndercityRoomEntered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const events = grantInitiative(game, seat0);
    expect(game.flags.initiative).toBe(seat0);
    // Wave 45 — taking the initiative also ventures one room.
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("BecameInitiative");
    expect(events[1]?.kind).toBe("UndercityRoomEntered");
    expect(game.flags.undercityRoom).toBe(1);
    // Wave 70.B — the room name is the canonical Forge label.
    if (events[1]?.kind === "UndercityRoomEntered") {
      expect(events[1].payload.roomName).toBe("Secret Entrance");
    }
  });

  it("grantInitiative is idempotent on self-grant (no event)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    grantInitiative(game, seat0);
    const events = grantInitiative(game, seat0);
    expect(events).toHaveLength(0);
  });

  it("combat damage to the holder transfers initiative to the source's controller", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const attackerId = mkEntityId(10);
    const paper = {
      name: "Goblin",
      edition: "LEA",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    const card = new Card(attackerId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(attackerId, card);
    grantInitiative(game, seat1);
    const events = onCombatDamageToPlayer(game, attackerId, seat1, 1);
    expect(game.flags.initiative).toBe(seat0);
    expect(events.some((e) => e.kind === "BecameInitiative")).toBe(true);
  });

  it("combat damage to a non-holder is a no-op", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const attackerId = mkEntityId(20);
    const paper = {
      name: "Goblin",
      edition: "LEA",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    const card = new Card(attackerId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(attackerId, card);
    grantInitiative(game, seat0); // attacker's controller is already the holder
    const events = onCombatDamageToPlayer(game, attackerId, seat1, 1);
    expect(events).toHaveLength(0);
    expect(game.flags.initiative).toBe(seat0);
  });
});

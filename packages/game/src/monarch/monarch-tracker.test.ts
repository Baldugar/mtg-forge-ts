// SPDX-License-Identifier: GPL-3.0-or-later
// Monarch tracker tests — CR 716. Verifies grant + transfer + end-step
// draw semantics. Combat-flow integration with CombatHandler is exercised
// in combat-handler.initiative-monarch.test.ts.
import type { DecisionResponse, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
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
import { PhaseHandler } from "../phase/phase-handler.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { grantMonarch, onCombatDamageToPlayer } from "./monarch-tracker.js";

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

const samplePaper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
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

const addCardToZone = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, samplePaper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("missing zone");
  z.add(id);
  return card;
};

const drive = (handler: PhaseHandler): EngineYield[] => {
  const yields: EngineYield[] = [];
  const gen = handler.run();
  let next = gen.next();
  while (!next.done) {
    yields.push(next.value);
    if (next.value.kind === "decision" && next.value.request.kind === "priority") {
      const response: DecisionResponse = { kind: "priority", action: { kind: "pass" } };
      next = gen.next(response);
    } else {
      next = gen.next();
    }
  }
  return yields;
};

describe("MonarchTracker", () => {
  it("grantMonarch sets the holder + emits BecameMonarch (no LostMonarch first time)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const events = grantMonarch(game, seat0);
    expect(game.flags.monarch).toBe(seat0);
    expect(events.map((e) => e.kind)).toEqual(["BecameMonarch"]);
  });

  it("grantMonarch swap emits LostMonarch then BecameMonarch", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    grantMonarch(game, seat0);
    const events = grantMonarch(game, seat1);
    expect(events.map((e) => e.kind)).toEqual(["LostMonarch", "BecameMonarch"]);
    expect(game.flags.monarch).toBe(seat1);
  });

  it("combat damage to the monarch transfers monarchy to the source's controller", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const attackerId = mkEntityId(40);
    addCardToZone(game, seat0, ZoneType.Battlefield, attackerId);
    grantMonarch(game, seat1);
    const events = onCombatDamageToPlayer(game, attackerId, seat1, 3);
    expect(game.flags.monarch).toBe(seat0);
    expect(events.map((e) => e.kind)).toEqual(["LostMonarch", "BecameMonarch"]);
  });

  it("monarch draws one card at the beginning of their end step", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    grantMonarch(game, seat0);
    // Two cards: one for the regular Draw step, one for the EndStep monarch draw.
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(101));
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(102));
    const handler = new PhaseHandler(game);
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const yields = drive(handler);
    const events = yields
      .filter((y): y is Extract<EngineYield, { kind: "event" }> => y.kind === "event")
      .map((y) => y.event);
    // CardDrawn during EndStep — find the draw whose phase is EndStep.
    const draws = events.filter((e) => e.kind === "CardDrawn");
    const endStepDraws = draws.filter((e) => e.phase === PhaseStep.EndStep);
    expect(endStepDraws).toHaveLength(1);
  });
});

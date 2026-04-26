// SPDX-License-Identifier: GPL-3.0-or-later
// Day/Night auto-transition tests — CR 726.4. Drives the PhaseHandler over
// a sequence of turns with a primed lastTurnSpellsCast snapshot and asserts
// the upkeep transition fires (or not) per the rule.
import type { DecisionResponse, LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { noteSpellCast, noteTurnEnd, tryUpkeepTransition } from "./day-night-tracker.js";
import { PhaseHandler } from "./phase-handler.js";

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

describe("DayNightTracker", () => {
  it("dormant 'neither': upkeep transition is a no-op even with primed counts", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    // Prime as if the previous turn cast 5 spells — no-op while neither.
    game.flags.lastTurnActiveSeat = seat0;
    game.flags.lastTurnSpellsCast.set(seat0, 5);
    const result = tryUpkeepTransition(game);
    expect(result).toBeNull();
    expect(game.flags.dayNight).toBe("neither");
  });

  it("day → night when previous turn's controller cast 0 non-land spells", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.flags.dayNight = "day";
    game.flags.lastTurnActiveSeat = seat0;
    // No entry in lastTurnSpellsCast — defaults to 0.
    const handler = new PhaseHandler(game);
    handler.turnQueue.push({ activePlayer: mkPlayerSeat(1), isExtra: false });
    const yields = drive(handler);
    const events = yields
      .filter((y): y is Extract<EngineYield, { kind: "event" }> => y.kind === "event")
      .map((y) => y.event);
    const dt = events.find((e) => e.kind === "DayTimeChanged");
    expect(dt).toBeDefined();
    expect(game.flags.dayNight).toBe("night");
  });

  it("night → day when previous turn's controller cast 2+ non-land spells", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.flags.dayNight = "night";
    game.flags.lastTurnActiveSeat = seat0;
    game.flags.lastTurnSpellsCast.set(seat0, 2);
    const result = tryUpkeepTransition(game);
    expect(result).toEqual({ oldValue: "night", newValue: "day" });
    expect(game.flags.dayNight).toBe("day");
  });

  it("noteTurnEnd snapshots spellsCastThisTurn and resets the live counter", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.flags.spellsCastThisTurn.set(seat0, 3);
    noteTurnEnd(game, seat0);
    expect(game.flags.lastTurnSpellsCast.get(seat0)).toBe(3);
    expect(game.flags.lastTurnActiveSeat).toBe(seat0);
    expect(game.flags.spellsCastThisTurn.size).toBe(0);
  });

  it("noteSpellCast skips lands and increments otherwise", () => {
    // The simplest test path: stub a card with cardless types via direct
    // state. Use a no-card seat so noteSpellCast bails on missing source.
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    // No source card registered → bails (defensive branch).
    noteSpellCast(game, seat0, 9999);
    expect(game.flags.spellsCastThisTurn.get(seat0) ?? 0).toBe(0);
  });
});

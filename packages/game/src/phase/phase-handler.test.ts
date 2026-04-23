// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  canonicalPhaseSequence,
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
import { PhaseHandler } from "./phase-handler.js";

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
  }
};

const addCardToZone = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, samplePaper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const mkGame = (overrides?: Partial<GameRules>): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules: { ...rules, ...overrides },
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(g);
  return g;
};

// Drive a PhaseHandler generator to completion, collecting yielded events
// and decisions. For priority yields we always pass, mirroring the SP1
// "no-op priority window" contract (concede branches are covered by the
// integration smoke test).
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

const eventKinds = (ys: EngineYield[]): string[] =>
  ys.map((y) => (y.kind === "event" ? y.event.kind : `decision:${y.request.kind}`));

const onlyEvents = (ys: EngineYield[]): GameEvent[] =>
  ys.filter((y): y is Extract<EngineYield, { kind: "event" }> => y.kind === "event").map((y) => y.event);

describe("PhaseHandler.run", () => {
  it("empty turn queue: generator completes immediately with no yields", () => {
    const game = mkGame();
    const handler = new PhaseHandler(game);
    const yields = drive(handler);
    expect(yields).toHaveLength(0);
  });

  it("single turn: emits TurnStarted, per-step StepStarted/StepEnded, TurnEnded", () => {
    const game = mkGame();
    const handler = new PhaseHandler(game);
    handler.turnQueue.push({ activePlayer: mkPlayerSeat(0), isExtra: false });
    const yields = drive(handler);
    const kinds = eventKinds(yields);
    // First yield is TurnStarted, last is TurnEnded.
    expect(kinds[0]).toBe("TurnStarted");
    expect(kinds[kinds.length - 1]).toBe("TurnEnded");
    // One StepStarted and one StepEnded per step in canonicalPhaseSequence.
    const startedCount = kinds.filter((k) => k === "StepStarted").length;
    const endedCount = kinds.filter((k) => k === "StepEnded").length;
    expect(startedCount).toBe(canonicalPhaseSequence.length);
    expect(endedCount).toBe(canonicalPhaseSequence.length);
  });

  it("StepStarted/StepEnded payloads carry the correct step and activeSeat", () => {
    const game = mkGame();
    const handler = new PhaseHandler(game);
    const seat = mkPlayerSeat(0);
    handler.turnQueue.push({ activePlayer: seat, isExtra: false });
    const events = onlyEvents(drive(handler));
    const stepStarts = events.filter((e) => e.kind === "StepStarted");
    expect(stepStarts).toHaveLength(canonicalPhaseSequence.length);
    for (let i = 0; i < canonicalPhaseSequence.length; i++) {
      const expected = canonicalPhaseSequence[i];
      const evt = stepStarts[i];
      if (!evt || evt.kind !== "StepStarted") throw new Error("expected StepStarted");
      expect(evt.payload.step).toBe(expected);
      expect(evt.payload.activeSeat).toBe(seat);
    }
  });

  it("Untap step untaps all tapped permanents of the active player", () => {
    const game = mkGame();
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    const t1 = mkEntityId(1);
    const t2 = mkEntityId(2);
    const notTapped = mkEntityId(3);
    const tappedA = addCardToZone(game, seat0, ZoneType.Battlefield, t1);
    const tappedB = addCardToZone(game, seat0, ZoneType.Battlefield, t2);
    const untappedC = addCardToZone(game, seat0, ZoneType.Battlefield, notTapped);
    tappedA.tapped = true;
    tappedB.tapped = true;
    untappedC.tapped = false;

    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const events = onlyEvents(drive(handler));
    const untaps = events.filter((e) => e.kind === "CardUntapped");
    // Only the two tapped cards should produce CardUntapped events.
    expect(untaps).toHaveLength(2);
    expect(tappedA.tapped).toBe(false);
    expect(tappedB.tapped).toBe(false);
  });

  it("Draw step draws one card on turn 1 for the non-first player even when firstPlayerSkipsDraw", () => {
    const game = mkGame();
    const handler = new PhaseHandler(game);
    const seat1 = mkPlayerSeat(1);
    const topCard = mkEntityId(100);
    addCardToZone(game, seat1, ZoneType.Library, topCard);
    handler.turnQueue.push({ activePlayer: seat1, isExtra: false });
    const events = onlyEvents(drive(handler));
    const draws = events.filter((e) => e.kind === "CardDrawn");
    expect(draws).toHaveLength(1);
    if (draws[0]?.kind !== "CardDrawn") throw new Error("expected CardDrawn");
    expect(draws[0].payload.cardId).toBe(topCard);
    expect(draws[0].payload.playerSeat).toBe(seat1);
  });

  it("Draw step is skipped on turn 1 for the first player when firstPlayerSkipsDraw=true", () => {
    const game = mkGame({ firstPlayerSkipsDraw: true });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(200));
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const events = onlyEvents(drive(handler));
    const draws = events.filter((e) => e.kind === "CardDrawn");
    expect(draws).toHaveLength(0);
  });

  it("firstPlayerSkipsDraw=false: first player does draw on turn 1", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(300));
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const events = onlyEvents(drive(handler));
    expect(events.filter((e) => e.kind === "CardDrawn")).toHaveLength(1);
  });

  it("skip turn: pop-through without emitting turn-scoped events; next real turn runs", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(400));
    // Push real turn, then inject a skip — the skip fires FIRST and is a
    // no-op, then the real turn runs.
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    handler.turnQueue.injectSkip(1);
    const events = onlyEvents(drive(handler));
    // Exactly ONE TurnStarted + ONE TurnEnded should be emitted (from the
    // real turn after the skip).
    expect(events.filter((e) => e.kind === "TurnStarted")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "TurnEnded")).toHaveLength(1);
  });

  it("multiple turns run sequentially and game.turn increments per turn", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    expect(game.turn).toBe(1);
    handler.turnQueue.push({ activePlayer: mkPlayerSeat(0), isExtra: false });
    handler.turnQueue.push({ activePlayer: mkPlayerSeat(1), isExtra: false });
    const events = onlyEvents(drive(handler));
    expect(events.filter((e) => e.kind === "TurnStarted")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "TurnEnded")).toHaveLength(2);
    // After two turns, the counter advanced twice from its initial value.
    expect(game.turn).toBe(3);
  });

  it("activePlayer is assigned from the current Turn before each turn runs", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    const seat1 = mkPlayerSeat(1);
    handler.turnQueue.push({ activePlayer: seat1, isExtra: false });
    drive(handler);
    expect(game.activePlayer).toBe(seat1);
  });

  it("isTerminal set before run(): generator ends without yielding any event", () => {
    const game = mkGame();
    const handler = new PhaseHandler(game);
    handler.turnQueue.push({ activePlayer: mkPlayerSeat(0), isExtra: false });
    game.terminalState = {
      endedAt: { turn: 1, phase: game.phase },
      outcome: { kind: "win", winner: mkPlayerSeat(1), reason: "concede" },
      concededSeats: [mkPlayerSeat(0)],
    };
    const yields = drive(handler);
    expect(yields).toHaveLength(0);
  });

  it("concede during priority: GameEnded is the final event (no TurnEnded after)", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(700));
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    // Also queue a second turn so we can verify it is NOT consumed after
    // the concede terminates the game — the second turn would have
    // incremented game.turn past the terminal point without the guard.
    handler.turnQueue.push({ activePlayer: mkPlayerSeat(1), isExtra: false });

    const yields: EngineYield[] = [];
    const gen = handler.run();
    let next = gen.next();
    let decisionCount = 0;
    while (!next.done) {
      yields.push(next.value);
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        decisionCount++;
        // Concede on the very first priority window so the game ends mid-turn.
        const action = decisionCount === 1 ? { kind: "concede" as const } : { kind: "pass" as const };
        const response: DecisionResponse = { kind: "priority", action };
        next = gen.next(response);
      } else {
        next = gen.next();
      }
    }
    const events = onlyEvents(yields);
    const kinds = events.map((e) => e.kind);
    // GameEnded must be present and must be the LAST event (no zombie TurnEnded).
    expect(kinds).toContain("GameEnded");
    expect(kinds[kinds.length - 1]).toBe("GameEnded");
    expect(kinds).not.toContain("TurnEnded");
    // Turn counter must NOT have incremented past the concede turn.
    expect(game.turn).toBe(1);
    // And only one TurnStarted should have been emitted (the second queued
    // turn never runs — the loop bails as soon as terminal state is set).
    expect(kinds.filter((k) => k === "TurnStarted")).toHaveLength(1);
  });

  it("firstTurnDrawSkipped flag records true for first player on turn 1 when firstPlayerSkipsDraw", () => {
    const game = mkGame({ firstPlayerSkipsDraw: true });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(800));
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    drive(handler);
    expect(game.flags.firstTurnDrawSkipped.get(seat0)).toBe(true);
  });

  it("firstTurnDrawSkipped flag records false when the first player actually draws on turn 1", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(801));
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    drive(handler);
    expect(game.flags.firstTurnDrawSkipped.get(seat0)).toBe(false);
  });

  it("firstTurnDrawSkipped flag records false for the non-first player on turn 1", () => {
    const game = mkGame({ firstPlayerSkipsDraw: true });
    const handler = new PhaseHandler(game);
    const seat1 = mkPlayerSeat(1);
    addCardToZone(game, seat1, ZoneType.Library, mkEntityId(802));
    handler.turnQueue.push({ activePlayer: seat1, isExtra: false });
    drive(handler);
    expect(game.flags.firstTurnDrawSkipped.get(seat1)).toBe(false);
  });

  it("phaseSequence is respected: skipping Draw removes its Step events", () => {
    const game = mkGame({ firstPlayerSkipsDraw: false });
    const handler = new PhaseHandler(game);
    const seat0 = mkPlayerSeat(0);
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(500));
    handler.phaseSequence.skipStep(PhaseStep.Draw);
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const events = onlyEvents(drive(handler));
    // No CardDrawn because Draw step was removed from the sequence entirely.
    expect(events.filter((e) => e.kind === "CardDrawn")).toHaveLength(0);
    const stepStarts = events.filter(
      (e): e is Extract<GameEvent, { kind: "StepStarted" }> => e.kind === "StepStarted",
    );
    expect(stepStarts.every((e) => e.payload.step !== PhaseStep.Draw)).toBe(true);
  });
});

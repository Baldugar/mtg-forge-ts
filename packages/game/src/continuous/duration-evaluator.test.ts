// SPDX-License-Identifier: GPL-3.0-or-later
import type { ContinuousEffect, GameEvent, LobbyPlayer } from "@mtg-forge-ts/core";
import { Layer, PhaseStep, SeededRng, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { type ExpiryContext, isExpired } from "./duration-evaluator.js";

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

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const mkEffect = (duration: ContinuousEffect["duration"]): ContinuousEffect => ({
  id: mkEntityId(100),
  sourceCardId: mkEntityId(101),
  timestamp: 1,
  layer: Layer.L7c_PTModify,
  duration,
  payload: { kind: "pt-modify", effect: { sourceAbilityId: null, layer: Layer.L7c_PTModify, timestamp: 1 } },
});

const evt = (event: GameEvent): ExpiryContext => ({ kind: "event", event });

describe("duration-evaluator (SP2 Task 33)", () => {
  it("permanent duration never expires", () => {
    const game = mkGame();
    const effect = mkEffect({ kind: "permanent" });
    const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    expect(isExpired(effect, evt(turnEnded), game)).toBe(false);
    expect(isExpired(effect, { kind: "epochBump" }, game)).toBe(false);
  });

  it("untilEndOfTurn expires on TurnEnded", () => {
    const game = mkGame();
    const effect = mkEffect({ kind: "untilEndOfTurn" });
    const turnEnded = mkEvent("TurnEnded", 3, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    expect(isExpired(effect, evt(turnEnded), game)).toBe(true);
  });

  it("untilEndOfTurn does not expire on non-TurnEnded events", () => {
    const game = mkGame();
    const effect = mkEffect({ kind: "untilEndOfTurn" });
    const stepStarted = mkEvent("StepStarted", 1, PhaseStep.Main1, {
      activeSeat: mkPlayerSeat(0),
      step: PhaseStep.Main1,
    });
    expect(isExpired(effect, evt(stepStarted), game)).toBe(false);
  });

  it("untilEndOfYourNextTurn expires only on forSeat's next turn end", () => {
    const game = mkGame();
    const effect = mkEffect({
      kind: "untilEndOfYourNextTurn",
      forSeat: mkPlayerSeat(0),
      registeredAtTurn: 1,
    });
    // Turn 1 ending (registered during turn 1, same seat) — survives.
    const turn1End = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    expect(isExpired(effect, evt(turn1End), game)).toBe(false);
    // Turn 2 ending, opponent's turn — survives (wrong seat).
    const turn2End = mkEvent("TurnEnded", 2, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(1) });
    expect(isExpired(effect, evt(turn2End), game)).toBe(false);
    // Turn 3 ending, forSeat's next turn — expires.
    const turn3End = mkEvent("TurnEnded", 3, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    expect(isExpired(effect, evt(turn3End), game)).toBe(true);
  });

  it("untilXLeavesBattlefield expires when X leaves the battlefield", () => {
    const game = mkGame();
    const xId = mkEntityId(42);
    const effect = mkEffect({ kind: "untilXLeavesBattlefield", xId });
    const leavesBf = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: xId,
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
    });
    expect(isExpired(effect, evt(leavesBf), game)).toBe(true);
  });

  it("untilXLeavesBattlefield does not expire for other cards or other zones", () => {
    const game = mkGame();
    const xId = mkEntityId(42);
    const effect = mkEffect({ kind: "untilXLeavesBattlefield", xId });
    // Different card leaving battlefield — no.
    const otherLeaves = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: mkEntityId(99),
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
    });
    expect(isExpired(effect, evt(otherLeaves), game)).toBe(false);
    // X moves between non-battlefield zones — no.
    const handToGraveyard = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: xId,
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Graveyard,
    });
    expect(isExpired(effect, evt(handToGraveyard), game)).toBe(false);
  });

  it("untilCombatEnds expires on CombatEnded", () => {
    const game = mkGame();
    const effect = mkEffect({ kind: "untilCombatEnds" });
    const combatEnded = mkEvent("CombatEnded", 1, PhaseStep.EndOfCombat, {
      attackingSeat: mkPlayerSeat(0),
    });
    expect(isExpired(effect, evt(combatEnded), game)).toBe(true);
    // TurnEnded does not trigger untilCombatEnds.
    const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    expect(isExpired(effect, evt(turnEnded), game)).toBe(false);
  });

  it("untilEndOfNextStep expires on matching PhaseStepEnded", () => {
    const game = mkGame();
    const effect = mkEffect({ kind: "untilEndOfNextStep", step: PhaseStep.Upkeep });
    const upkeepEnded = mkEvent("PhaseStepEnded", 1, PhaseStep.Upkeep, { step: PhaseStep.Upkeep });
    expect(isExpired(effect, evt(upkeepEnded), game)).toBe(true);
    const drawEnded = mkEvent("PhaseStepEnded", 1, PhaseStep.Draw, { step: PhaseStep.Draw });
    expect(isExpired(effect, evt(drawEnded), game)).toBe(false);
  });

  it("asLongAs stub (Task 33) with always condition never expires", () => {
    const game = mkGame();
    const effect = mkEffect({ kind: "asLongAs", condition: { kind: "always" } });
    const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    expect(isExpired(effect, evt(turnEnded), game)).toBe(false);
    expect(isExpired(effect, { kind: "epochBump" }, game)).toBe(false);
  });

  it("epochBump context does not expire non-asLongAs effects", () => {
    const game = mkGame();
    const ctx: ExpiryContext = { kind: "epochBump" };
    expect(isExpired(mkEffect({ kind: "permanent" }), ctx, game)).toBe(false);
    expect(isExpired(mkEffect({ kind: "untilEndOfTurn" }), ctx, game)).toBe(false);
    expect(isExpired(mkEffect({ kind: "untilCombatEnds" }), ctx, game)).toBe(false);
    expect(isExpired(mkEffect({ kind: "untilXLeavesBattlefield", xId: mkEntityId(9) }), ctx, game)).toBe(
      false,
    );
  });
});

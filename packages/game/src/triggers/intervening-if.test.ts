// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for interveningIfStillTrue (CR 603.4, SP2 Task 22). The helper is
// the resolve-time check; the fire-time check is tested in trigger-
// registry.test.ts.
import type { GameEvent, LobbyPlayer, TriggeredAbility } from "@mtg-forge-ts/core";
import { PhaseStep, SeededRng, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { interveningIfStillTrue } from "./intervening-if.js";

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

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

const lifeChangedEvent = (): GameEvent =>
  mkEvent("LifeChanged", 1, PhaseStep.Main1, {
    playerSeat: mkPlayerSeat(0),
    oldLife: 20,
    newLife: 18,
    delta: -2,
    cause: "effect",
  });

const mkTrig = (interveningIf?: (e: GameEvent, g: unknown) => boolean): TriggeredAbility => {
  const t: TriggeredAbility = {
    id: mkEntityId(1),
    kind: "triggered",
    sourceCardId: mkEntityId(10),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: mkPlayerSeat(0),
    matches: () => true,
    isDelayed: false,
  };
  if (interveningIf) {
    (t as { interveningIf?: (e: GameEvent, g: unknown) => boolean }).interveningIf = interveningIf;
  }
  return t;
};

describe("interveningIfStillTrue (CR 603.4)", () => {
  it("returns true when the trigger has no interveningIf", () => {
    const g = mkGame();
    expect(interveningIfStillTrue(mkTrig(), lifeChangedEvent(), g)).toBe(true);
  });

  it("returns true when interveningIf returns true", () => {
    const g = mkGame();
    expect(
      interveningIfStillTrue(
        mkTrig(() => true),
        lifeChangedEvent(),
        g,
      ),
    ).toBe(true);
  });

  it("returns false when interveningIf returns false", () => {
    const g = mkGame();
    expect(
      interveningIfStillTrue(
        mkTrig(() => false),
        lifeChangedEvent(),
        g,
      ),
    ).toBe(false);
  });

  it("interveningIf receives the event and game — can branch on mutable state", () => {
    const g = mkGame();
    let seenEvent: GameEvent | null = null;
    let seenGame: unknown = null;
    const t = mkTrig((e, game) => {
      seenEvent = e;
      seenGame = game;
      return true;
    });
    const ev = lifeChangedEvent();
    interveningIfStillTrue(t, ev, g);
    expect(seenEvent).toBe(ev);
    expect(seenGame).toBe(g);
  });

  it("true at fire time but false at resolve time (condition flipped by intervening state)", () => {
    const g = mkGame();
    // Simulate state the predicate reads (e.g., "if you control a creature").
    let condition = true;
    const t = mkTrig(() => condition);
    // Fire-time check passes.
    expect(interveningIfStillTrue(t, lifeChangedEvent(), g)).toBe(true);
    // Some state change happens between fire and resolve.
    condition = false;
    // Resolve-time check fails — caller should skip the effect.
    expect(interveningIfStillTrue(t, lifeChangedEvent(), g)).toBe(false);
  });
});

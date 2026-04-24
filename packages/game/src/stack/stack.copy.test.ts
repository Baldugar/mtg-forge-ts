// SPDX-License-Identifier: GPL-3.0-or-later
// CR 707.10 — Stack.copy primitive tests.
//
// Behaviors locked:
//   1. Copy is a new item with kind="copy", isCast=false, new id.
//   2. Copy inherits sourceCardId/modes/targets/xValue/costPaid/provenance.
//   3. Copy's controllerSeat is the caller-provided seat (may differ).
//   4. With options.changeTargets: copy's targets replace source's targets.
//   5. Multiple copies have distinct ids.
//   6. Unknown sourceItemId throws GameStateIntegrityError.
//   7. Copy doesn't mutate source's fields.
//   8. Copy is pushed onto the stack (visible via top()/size).
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "./stack-item.js";

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
  gamesPerMatch: 1,
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

interface FakeTargets {
  readonly kind: "single";
  readonly cardId: number;
}

const mkItem = (id: number, sourceCardId: number, overrides: Partial<StackItem> = {}): StackItem => ({
  id: mkEntityId(id),
  sourceCardId: mkEntityId(sourceCardId),
  controllerSeat: mkPlayerSeat(0),
  kind: "spell",
  isCast: true,
  targets: { kind: "single", cardId: sourceCardId } satisfies FakeTargets,
  modes: ["mode-A"],
  xValue: 3,
  costPaid: { generic: 2 },
  provenance: {
    originZone: ZoneType.Hand,
    altCostUsed: null,
    additionalCostsPaid: [],
  },
  ...overrides,
});

describe("Stack.copy (CR 707.10)", () => {
  it("creates a new stack item with kind='copy' and isCast=false", () => {
    const g = mkGame();
    const source = mkItem(100, 500);
    g.sharedZones.stack.push(source);
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(copy.kind).toBe("copy");
    expect(copy.isCast).toBe(false);
  });

  it("copy's id differs from source's id", () => {
    const g = mkGame();
    const source = mkItem(101, 501);
    g.sharedZones.stack.push(source);
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(copy.id).not.toBe(source.id);
  });

  it("copy inherits sourceCardId, modes, xValue, costPaid, provenance", () => {
    const g = mkGame();
    const source = mkItem(102, 502);
    g.sharedZones.stack.push(source);
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(copy.sourceCardId).toBe(source.sourceCardId);
    expect(copy.modes).toEqual(source.modes);
    expect(copy.xValue).toBe(source.xValue);
    expect(copy.costPaid).toBe(source.costPaid);
    expect(copy.provenance).toBe(source.provenance);
  });

  it("copy preserves source's targets when changeTargets is omitted", () => {
    const g = mkGame();
    const source = mkItem(103, 503);
    g.sharedZones.stack.push(source);
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(copy.targets).toBe(source.targets);
  });

  it("controllerSeat takes the caller-provided seat (may differ from source)", () => {
    const g = mkGame();
    const source = mkItem(104, 504, { controllerSeat: mkPlayerSeat(0) });
    g.sharedZones.stack.push(source);
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(copy.controllerSeat).toBe(mkPlayerSeat(1));
    expect(source.controllerSeat).toBe(mkPlayerSeat(0));
  });

  it("with options.changeTargets: copy gets the provided targets, source unchanged", () => {
    const g = mkGame();
    const source = mkItem(105, 505);
    g.sharedZones.stack.push(source);
    const newTargets: FakeTargets = { kind: "single", cardId: 999 };
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g, {
      changeTargets: newTargets,
    });
    expect(copy.targets).toBe(newTargets);
    expect(source.targets).not.toBe(newTargets);
  });

  it("multiple copies of the same source all have distinct ids", () => {
    const g = mkGame();
    const source = mkItem(106, 506);
    g.sharedZones.stack.push(source);
    const c1 = g.sharedZones.stack.copy(source.id, mkPlayerSeat(0), g);
    const c2 = g.sharedZones.stack.copy(source.id, mkPlayerSeat(0), g);
    const c3 = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    const ids = new Set([source.id, c1.id, c2.id, c3.id]);
    expect(ids.size).toBe(4);
  });

  it("unknown sourceItemId throws GameStateIntegrityError", () => {
    const g = mkGame();
    const ghostId = mkEntityId(9999);
    expect(() => g.sharedZones.stack.copy(ghostId, mkPlayerSeat(0), g)).toThrow(GameStateIntegrityError);
  });

  it("copy does not mutate the source's fields", () => {
    const g = mkGame();
    const source = mkItem(107, 507);
    const snapshotKind = source.kind;
    const snapshotIsCast = source.isCast;
    const snapshotController = source.controllerSeat;
    const snapshotTargets = source.targets;
    g.sharedZones.stack.push(source);
    g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g, {
      changeTargets: { kind: "single", cardId: 42 } satisfies FakeTargets,
    });
    expect(source.kind).toBe(snapshotKind);
    expect(source.isCast).toBe(snapshotIsCast);
    expect(source.controllerSeat).toBe(snapshotController);
    expect(source.targets).toBe(snapshotTargets);
  });

  it("copy is pushed onto the stack (observable via top/size)", () => {
    const g = mkGame();
    const source = mkItem(108, 508);
    g.sharedZones.stack.push(source);
    expect(g.sharedZones.stack.size).toBe(1);
    const copy = g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(g.sharedZones.stack.size).toBe(2);
    expect(g.sharedZones.stack.top()).toBe(copy);
  });

  it("countItemsBySource counts both original and copy (they share sourceCardId)", () => {
    const g = mkGame();
    const source = mkItem(109, 509);
    g.sharedZones.stack.push(source);
    g.sharedZones.stack.copy(source.id, mkPlayerSeat(0), g);
    g.sharedZones.stack.copy(source.id, mkPlayerSeat(1), g);
    expect(g.sharedZones.stack.countItemsBySource(mkEntityId(509))).toBe(3);
  });
});

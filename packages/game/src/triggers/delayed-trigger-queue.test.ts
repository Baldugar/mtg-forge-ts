// SPDX-License-Identifier: GPL-3.0-or-later
// DelayedTriggerQueue tests — CR 603.7 (SP2 Task 23). The queue observes
// events via Game.emitEvent's pipe and forwards matching delayed
// triggers to the TriggerRegistry via onEventForcedByDelayed.
import type { DelayedTrigger, GameEvent, LobbyPlayer } from "@mtg-forge-ts/core";
import { PhaseStep, SeededRng, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { DelayedTriggerQueue } from "./delayed-trigger-queue.js";

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

interface MkDelayedOpts {
  readonly id: number;
  readonly sourceCardId: number;
  readonly oneShot: boolean;
  readonly matchesFn?: (e: GameEvent) => boolean;
}

const mkDelayed = (opts: MkDelayedOpts): DelayedTrigger => ({
  id: mkEntityId(opts.id),
  kind: "triggered",
  isDelayed: true,
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  createdAtTurn: 1,
  creationContext: {},
  oneShot: opts.oneShot,
  matches: opts.matchesFn ?? (() => true),
});

describe("DelayedTriggerQueue (CR 603.7)", () => {
  it("add → queue size 1", () => {
    const q = new DelayedTriggerQueue();
    q.add(mkDelayed({ id: 1, sourceCardId: 10, oneShot: true }));
    expect(q.size()).toBe(1);
    expect(q.snapshot()).toHaveLength(1);
  });

  it("matching event → forwarded to TriggerRegistry; PendingTrigger created", () => {
    const g = mkGame();
    const d = mkDelayed({ id: 1, sourceCardId: 10, oneShot: true });
    g.delayedTriggerQueue.add(d);
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    const pending = g.triggerRegistry.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.triggerId).toBe(mkEntityId(1));
    expect(pending[0]?.sourceCardId).toBe(mkEntityId(10));
  });

  it("one-shot delayed trigger fires once → removed from queue", () => {
    const g = mkGame();
    const d = mkDelayed({ id: 1, sourceCardId: 10, oneShot: true });
    g.delayedTriggerQueue.add(d);
    expect(g.delayedTriggerQueue.size()).toBe(1);
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    expect(g.delayedTriggerQueue.size()).toBe(0);
  });

  it("persistent delayed trigger fires multiple times → stays in queue", () => {
    const g = mkGame();
    const d = mkDelayed({ id: 1, sourceCardId: 10, oneShot: false });
    g.delayedTriggerQueue.add(d);
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    expect(g.delayedTriggerQueue.size()).toBe(1);
    expect(g.triggerRegistry.drain()).toHaveLength(3);
  });

  it("non-matching event → queue unchanged, no pending created", () => {
    const g = mkGame();
    g.delayedTriggerQueue.add(mkDelayed({ id: 1, sourceCardId: 10, oneShot: true, matchesFn: () => false }));
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    expect(g.delayedTriggerQueue.size()).toBe(1);
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });

  it("multiple delayed triggers match same event → all forwarded", () => {
    const g = mkGame();
    g.delayedTriggerQueue.add(mkDelayed({ id: 1, sourceCardId: 10, oneShot: true }));
    g.delayedTriggerQueue.add(mkDelayed({ id: 2, sourceCardId: 11, oneShot: true }));
    g.delayedTriggerQueue.add(mkDelayed({ id: 3, sourceCardId: 12, oneShot: false }));
    g.delayedTriggerQueue.onEvent(lifeChangedEvent(), g.triggerRegistry);
    expect(g.triggerRegistry.drain()).toHaveLength(3);
    // One-shots removed, persistent remains.
    expect(g.delayedTriggerQueue.size()).toBe(1);
  });

  it("remove(d) works correctly mid-queue", () => {
    const q = new DelayedTriggerQueue();
    const a = mkDelayed({ id: 1, sourceCardId: 10, oneShot: true });
    const b = mkDelayed({ id: 2, sourceCardId: 11, oneShot: true });
    const c = mkDelayed({ id: 3, sourceCardId: 12, oneShot: true });
    q.add(a);
    q.add(b);
    q.add(c);
    q.remove(b);
    expect(q.size()).toBe(2);
    expect(q.snapshot()).toEqual([a, c]);
  });

  it("clear() empties the queue", () => {
    const q = new DelayedTriggerQueue();
    q.add(mkDelayed({ id: 1, sourceCardId: 10, oneShot: true }));
    q.add(mkDelayed({ id: 2, sourceCardId: 11, oneShot: false }));
    q.clear();
    expect(q.size()).toBe(0);
  });

  it("Game.emitEvent routes to both trigger registry and delayed queue (integration)", () => {
    const g = mkGame();
    // Register a delayed trigger matching LifeChanged.
    g.delayedTriggerQueue.add(mkDelayed({ id: 42, sourceCardId: 10, oneShot: true }));
    // Emit a canonical event via the single pipe.
    const yld = g.emitEvent(lifeChangedEvent());
    expect(yld.kind).toBe("event");
    const pending = g.triggerRegistry.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.triggerId).toBe(mkEntityId(42));
    // One-shot was removed.
    expect(g.delayedTriggerQueue.size()).toBe(0);
  });

  it("Game.emitEvent does NOT route engine-internal kinds to the delayed queue", () => {
    const g = mkGame();
    g.delayedTriggerQueue.add(mkDelayed({ id: 1, sourceCardId: 10, oneShot: true }));
    // Engine-internal kind — filtered out by the pipe.
    const ev = mkEvent("StateBasedActionApplied", 1, PhaseStep.Main1, { actionCount: 1 });
    g.emitEvent(ev);
    expect(g.delayedTriggerQueue.size()).toBe(1);
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "./stack-item.js";
import { Stack } from "./stack.js";

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
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkItem = (id: number, sourceCardId: number): StackItem => ({
  id: mkEntityId(id),
  sourceCardId: mkEntityId(sourceCardId),
  controllerSeat: mkPlayerSeat(0),
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

describe("Stack", () => {
  it("is empty on construction", () => {
    const stack = new Stack();
    expect(stack.size).toBe(0);
    expect(stack.isEmpty()).toBe(true);
    expect(stack.top()).toBeUndefined();
    expect(stack.pop()).toBeUndefined();
  });

  it("has type ZoneType.Stack", () => {
    const stack = new Stack();
    expect(stack.type).toBe(ZoneType.Stack);
  });

  it("push/top/pop follows LIFO order", () => {
    const stack = new Stack();
    const a = mkItem(1, 100);
    const b = mkItem(2, 101);
    stack.push(a);
    stack.push(b);
    expect(stack.size).toBe(2);
    expect(stack.top()).toBe(b);
    expect(stack.pop()).toBe(b);
    expect(stack.top()).toBe(a);
    expect(stack.pop()).toBe(a);
    expect(stack.isEmpty()).toBe(true);
  });

  it("peek returns item at index (0 = bottom, size-1 = top)", () => {
    const stack = new Stack();
    const a = mkItem(1, 100);
    const b = mkItem(2, 101);
    const c = mkItem(3, 102);
    stack.push(a);
    stack.push(b);
    stack.push(c);
    expect(stack.peek(0)).toBe(a);
    expect(stack.peek(1)).toBe(b);
    expect(stack.peek(2)).toBe(c);
    expect(stack.peek(3)).toBeUndefined();
  });

  it("countItemsBySource counts items matching a given sourceCardId", () => {
    const stack = new Stack();
    stack.push(mkItem(1, 42));
    stack.push(mkItem(2, 42));
    stack.push(mkItem(3, 7));
    const cardFortyTwo: EntityId = mkEntityId(42);
    const cardSeven: EntityId = mkEntityId(7);
    const cardAbsent: EntityId = mkEntityId(999);
    expect(stack.countItemsBySource(cardFortyTwo)).toBe(2);
    expect(stack.countItemsBySource(cardSeven)).toBe(1);
    expect(stack.countItemsBySource(cardAbsent)).toBe(0);
  });

  it("toArray returns an independent copy (mutation doesn't affect stack)", () => {
    const stack = new Stack();
    stack.push(mkItem(1, 100));
    const out = stack.toArray();
    out.length = 0;
    expect(stack.size).toBe(1);
  });

  it("toJSON includes the items array", () => {
    const stack = new Stack();
    const a = mkItem(1, 100);
    stack.push(a);
    const json = stack.toJSON();
    expect(json.items).toHaveLength(1);
    expect(json.items[0]?.id).toBe(mkEntityId(1));
  });

  it("Game.sharedZones.stack is a Stack instance initialized empty", () => {
    const g = new Game({
      lobbyPlayers: [alice, bob],
      rules,
      meta,
      rng: new SeededRng(1n),
    });
    expect(g.sharedZones.stack).toBeInstanceOf(Stack);
    expect(g.sharedZones.stack.size).toBe(0);
    expect(g.sharedZones.stack.isEmpty()).toBe(true);
  });
});

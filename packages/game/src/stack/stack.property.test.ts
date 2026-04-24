// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 78 — property tests for the Stack.
//
// Property 1 (LIFO): push N items in order, pop N returns in reverse. The
// stack is strictly LIFO per CR 405.4 (resolve top-down).
//
// Property 2 (Stack.copy distinct ids): calling copy() on a pushed item
// mints a fresh EntityId that is NOT equal to the source's id — copies are
// independent stack items per CR 707.10. We extend the property over any
// permutation of pushes and any source-to-copy choice.
import type { EntityId, LobbyPlayer, PlayerSeat } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import fc from "fast-check";
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

const mkItem = (id: EntityId, sourceCardId: EntityId, seat: PlayerSeat): StackItem => ({
  id,
  sourceCardId,
  controllerSeat: seat,
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

describe("Stack — LIFO + copy properties", () => {
  it("LIFO: push N items, pop N returns them in reverse push order", () => {
    fc.assert(
      fc.property(
        // Audit D-C5 — use fc.uniqueArray to eliminate dedup post-processing.
        // minLength=2 ensures non-trivial LIFO behavior; collisions would
        // make reversal ambiguous (Stack.copy uses id as lookup key).
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 30 }),
        (rawIds) => {
          const ids = rawIds.map((n) => mkEntityId(n));
          const seat = mkPlayerSeat(0);
          const stack = new Stack();
          const pushedItems: StackItem[] = [];
          for (const id of ids) {
            const item = mkItem(id, id, seat);
            stack.push(item);
            pushedItems.push(item);
          }
          expect(stack.size).toBe(ids.length);
          // Pop everything; expect ids in reverse push order.
          const popped: StackItem[] = [];
          while (!stack.isEmpty()) {
            const it = stack.pop();
            if (it) popped.push(it);
          }
          expect(popped.map((p) => p.id)).toEqual([...pushedItems].reverse().map((p) => p.id));
          expect(stack.size).toBe(0);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("Stack.copy mints a fresh id distinct from the source", () => {
    fc.assert(
      fc.property(
        // Audit D-C5 — fc.uniqueArray with minLength=2 so we always have
        // material to copy from AND a genuine permutation.
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 10 }),
        fc.nat({ max: 9 }),
        (rawIds, copyIndexSeed) => {
          const ids = rawIds.map((n) => mkEntityId(n));
          const seat = mkPlayerSeat(0);
          const game = new Game({
            lobbyPlayers: [alice, bob],
            rules,
            meta,
            rng: new SeededRng(1n),
          });
          const stack = game.sharedZones.stack;
          const pushed: StackItem[] = [];
          for (const id of ids) {
            const item = mkItem(id, id, seat);
            stack.push(item);
            pushed.push(item);
          }
          // Pick one item to copy; clamp the index to the available set.
          const source = pushed[copyIndexSeed % pushed.length];
          if (!source) throw new Error("test: no source");
          const copy = stack.copy(source.id, seat, game);
          // Property: the copy has a distinct id.
          expect(copy.id).not.toBe(source.id);
          // Property: copy.kind is "copy" and isCast is false.
          expect(copy.kind).toBe("copy");
          expect(copy.isCast).toBe(false);
          // Property: the copy is now on top of the stack.
          expect(stack.top()?.id).toBe(copy.id);
          // Property: size increased by exactly one.
          expect(stack.size).toBe(ids.length + 1);
          // Property: copy.sourceCardId matches the source's.
          expect(copy.sourceCardId).toBe(source.sourceCardId);
        },
      ),
      { numRuns: 40 },
    );
  });

  // Audit D-C1 — multi-copy scenario + out-of-set id property. The copy
  // of a copy produces yet a third distinct id; the two copies and the
  // source are all simultaneously on the stack.
  it("Stack.copy on a copy produces a third distinct id (multi-copy scenario)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 8 }),
        fc.nat({ max: 7 }),
        (rawIds, copyIndexSeed) => {
          const ids = rawIds.map((n) => mkEntityId(n));
          const seat = mkPlayerSeat(0);
          const game = new Game({
            lobbyPlayers: [alice, bob],
            rules,
            meta,
            rng: new SeededRng(1n),
          });
          const stack = game.sharedZones.stack;
          for (const id of ids) stack.push(mkItem(id, id, seat));
          const source = ids[copyIndexSeed % ids.length];
          if (!source) throw new Error("test: no source");
          const copy1 = stack.copy(source, seat, game);
          const copy2 = stack.copy(copy1.id, seat, game);
          expect(copy1.id).not.toBe(source);
          expect(copy2.id).not.toBe(copy1.id);
          expect(copy2.id).not.toBe(source);
          expect(stack.size).toBe(ids.length + 2);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("Stack.copy of an out-of-set id throws GameStateIntegrityError", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 500_000 }), { minLength: 2, maxLength: 8 }),
        // Out-of-set id: drawn from a disjoint range so it's guaranteed
        // not to collide with the pushed ids.
        fc.integer({ min: 10_000_001, max: 20_000_000 }),
        (rawIds, outId) => {
          const ids = rawIds.map((n) => mkEntityId(n));
          const seat = mkPlayerSeat(0);
          const game = new Game({
            lobbyPlayers: [alice, bob],
            rules,
            meta,
            rng: new SeededRng(1n),
          });
          const stack = game.sharedZones.stack;
          for (const id of ids) stack.push(mkItem(id, id, seat));
          expect(() => stack.copy(mkEntityId(outId), seat, game)).toThrow(GameStateIntegrityError);
          // State preserved: stack size unchanged, no ghost entry.
          expect(stack.size).toBe(ids.length);
        },
      ),
      { numRuns: 30 },
    );
  });
});

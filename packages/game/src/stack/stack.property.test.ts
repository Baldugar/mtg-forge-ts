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
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
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
        // Distinct ids are required — the Stack treats `id` as the key for
        // lookups (used by Stack.copy). Collisions would make reversal
        // ambiguous.
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 30 }),
        (rawIds) => {
          const ids = Array.from(new Set(rawIds)).map((n) => mkEntityId(n));
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
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 10 }),
        fc.nat({ max: 9 }),
        (rawIds, copyIndexSeed) => {
          const ids = Array.from(new Set(rawIds)).map((n) => mkEntityId(n));
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
});

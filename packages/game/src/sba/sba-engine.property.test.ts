// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 78 — property tests for the SBA engine fixpoint loop.
//
// Property: any sequence of per-card applicable flags produces a sweep that
// terminates in at most MAX_ITERATIONS rounds and never throws the
// "exceeded N iterations" guard as long as each round strictly reduces the
// set of pending actions.
//
// We build a synthetic collector that tracks a per-card "pending" flag; on
// each sweep iteration it returns exactly the cards still flagged and
// synthesizes a `tokenCeaseExistence` action — which the base engine's
// apply() path removes the card from Game.cards, so the next collectApplicable
// call sees a strictly smaller flag set. This mirrors the contract every real
// collector must honor (each apply strictly reduces at least one collector's
// input signal) without depending on card-types / Characteristics / LayerEngine
// plumbing.
import type { EntityId, LobbyPlayer } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId } from "@mtg-forge-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";
import { SbaEngine } from "./sba-engine.js";

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

describe("SbaEngine — fixpoint property", () => {
  it("sweep terminates in <= cardCount iterations when each batch strictly reduces the flagged set", () => {
    fc.assert(
      fc.property(
        // 1..20 card ids, each marked "applicable" initially.
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 20 }),
        (rawIds) => {
          // Deduplicate ids to keep cards distinct.
          const uniqueIds = Array.from(new Set(rawIds));
          const game = mkGame();
          const paper = {
            name: "P",
            edition: "LEA",
            collectorNumber: "1",
            language: "en",
            foil: false,
            flags: DEFAULT_PAPER_CARD_FLAGS,
          } as const;
          const seat0 = game.players[0]?.seat;
          if (seat0 === undefined) throw new Error("test: missing seat");
          const flagged = new Set<EntityId>();
          for (const rawId of uniqueIds) {
            const id = mkEntityId(rawId);
            const card = new Card(id, paper, seat0, seat0, ZoneType.Battlefield);
            card.isToken = true; // tokenCeaseExistence applies to tokens only;
            game.cards.set(id, card);
            flagged.add(id);
          }
          // Custom engine: each sweep round emits tokenCeaseExistence for any
          // still-flagged card. The base apply() path deletes the Card from
          // game.cards and removes it from its zone, so the next round sees
          // a strictly smaller flag set. MAX_ITERATIONS guards a bugged
          // collector; the property asserts the guard is NEVER tripped.
          const engine = new (class extends SbaEngine {
            protected override collectApplicable(): SbaAction[] {
              const out: SbaAction[] = [];
              for (const id of flagged) {
                if (game.cards.has(id)) {
                  out.push({ kind: "tokenCeaseExistence", cardId: id });
                }
              }
              return out;
            }
          })(game);
          const gen = engine.sweep();
          const yields: EngineYield[] = [];
          let step = gen.next();
          // Count the number of rounds; each round emits one
          // StateBasedActionApplied event, so we count those.
          while (!step.done) {
            yields.push(step.value);
            step = gen.next();
          }
          const batches = step.value;
          const sbaEvents = yields.filter(
            (y) => y.kind === "event" && y.event.kind === "StateBasedActionApplied",
          );
          // Invariant: batch count == # of StateBasedActionApplied events.
          expect(sbaEvents.length).toBe(batches.length);
          // Invariant: never exceed |cards| iterations. The per-round apply
          // deletes ALL flagged cards in a single batch — so one round is
          // sufficient; the weaker bound cardCount captures the general
          // "strictly reduces" contract.
          expect(batches.length).toBeLessThanOrEqual(uniqueIds.length);
          expect(batches.length).toBeLessThanOrEqual(SbaEngine.MAX_ITERATIONS);
          // Invariant: all flagged cards are gone after the sweep.
          for (const id of flagged) {
            expect(game.cards.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("sweep on a no-op collector returns 0 batches and yields nothing", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (_noise) => {
        const game = mkGame();
        const engine = new (class extends SbaEngine {
          protected override collectApplicable(): SbaAction[] {
            return [];
          }
        })(game);
        const gen = engine.sweep();
        const yields: EngineYield[] = [];
        let step = gen.next();
        while (!step.done) {
          yields.push(step.value);
          step = gen.next();
        }
        const batches = step.value;
        expect(batches).toEqual([]);
        expect(yields).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  // Audit D-C4 — second property: collector that emits EXACTLY ONE action
  // per round (strictly reducing) should produce `batches.length ===
  // uniqueIds.length`. Exercises the strictly-reducing path where each
  // round dissolves one card, not all flagged at once.
  it("one-action-per-round collector produces batches.length === uniqueIds.length", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 12 }),
        (uniqueIds) => {
          const game = mkGame();
          const paper = {
            name: "P",
            edition: "LEA",
            collectorNumber: "1",
            language: "en",
            foil: false,
            flags: DEFAULT_PAPER_CARD_FLAGS,
          } as const;
          const seat0 = game.players[0]?.seat;
          if (seat0 === undefined) throw new Error("test: missing seat");
          const orderedIds: EntityId[] = [];
          for (const rawId of uniqueIds) {
            const id = mkEntityId(rawId);
            const card = new Card(id, paper, seat0, seat0, ZoneType.Battlefield);
            card.isToken = true;
            game.cards.set(id, card);
            orderedIds.push(id);
          }
          const engine = new (class extends SbaEngine {
            protected override collectApplicable(): SbaAction[] {
              // Return at most one applicable per round.
              for (const id of orderedIds) {
                if (game.cards.has(id)) {
                  return [{ kind: "tokenCeaseExistence", cardId: id }];
                }
              }
              return [];
            }
          })(game);
          const gen = engine.sweep();
          let step = gen.next();
          while (!step.done) step = gen.next();
          const batches = step.value;
          // Strictly-reducing path: one card removed per round.
          expect(batches.length).toBe(orderedIds.length);
          // All cards gone.
          for (const id of orderedIds) {
            expect(game.cards.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

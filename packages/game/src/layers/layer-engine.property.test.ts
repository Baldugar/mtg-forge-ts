// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 78 — property tests for the LayerEngine epoch cache.
//
// Property 1 (idempotency within epoch):
//   computeCharacteristics(id) returns the SAME reference across repeated
//   calls as long as the current epoch hasn't moved. The cache contract
//   (layer-engine.ts:99-105) hinges on that reference identity — tests for
//   layer stacking rely on it, and stale-cache bugs fall out immediately.
//
// Property 2 (bumpEpoch invalidation):
//   After bumpEpoch(reason), the NEXT computeCharacteristics call for any id
//   must NOT return a cached reference captured before the bump.
import type { EntityId, LobbyPlayer } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId } from "@mtg-forge-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";

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

const paper = {
  name: "P",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
} as const;

const mkGameWithCards = (cardIds: readonly EntityId[]): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  const seat = game.players[0]?.seat;
  if (seat === undefined) throw new Error("test: missing seat");
  for (const id of cardIds) {
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
  }
  return game;
};

describe("LayerEngine — epoch properties", () => {
  it("computeCharacteristics is reference-idempotent within the same epoch", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (rawIds, repeats) => {
          const ids = Array.from(new Set(rawIds)).map((n) => mkEntityId(n));
          const game = mkGameWithCards(ids);
          // First call populates the cache for each id.
          const firstRefs = new Map<EntityId, unknown>();
          for (const id of ids) {
            firstRefs.set(id, game.layerEngine.computeCharacteristics(id));
          }
          // Repeat reads within the same epoch; every call must return the
          // same reference. (Object identity, via Object.is.)
          for (let rep = 0; rep < repeats; rep++) {
            for (const id of ids) {
              const ref = game.layerEngine.computeCharacteristics(id);
              expect(Object.is(ref, firstRefs.get(id))).toBe(true);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("bumpEpoch invalidates the cache — next read returns a fresh reference", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        (rawIds, reason) => {
          const ids = Array.from(new Set(rawIds)).map((n) => mkEntityId(n));
          const game = mkGameWithCards(ids);
          const beforeRefs = new Map<EntityId, unknown>();
          for (const id of ids) {
            beforeRefs.set(id, game.layerEngine.computeCharacteristics(id));
          }
          const epochBefore = game.layerEngine.currentEpoch;
          game.layerEngine.bumpEpoch(reason);
          const epochAfter = game.layerEngine.currentEpoch;
          expect(epochAfter).toBeGreaterThan(epochBefore);
          // After bump, every read must be a NEW reference (cache cleared).
          for (const id of ids) {
            const after = game.layerEngine.computeCharacteristics(id);
            expect(Object.is(after, beforeRefs.get(id))).toBe(false);
          }
          // And the post-bump read is itself idempotent within the new
          // epoch (same reference on a repeat).
          for (const id of ids) {
            const a = game.layerEngine.computeCharacteristics(id);
            const b = game.layerEngine.computeCharacteristics(id);
            expect(Object.is(a, b)).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 78 — property test for the CR 614.5 one-apply rule.
//
// Property: regardless of how many matching replacements are registered and
// regardless of the chosen orderReplacements permutation, each replacement
// id appears at most ONCE in the returned appliedIds list. This is the core
// invariant of apply-loop.ts — the `applied` set joined on every apply makes
// re-matching a no-op.
//
// We generate an arbitrary set of non-mutating replacements (each passes the
// intent through unchanged) so the loop terminates when the registry is
// fully drained. Any non-terminating test shape would be a bug in the loop.
import type {
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { type ApplyResult, applyReplacementLoop } from "./apply-loop.js";

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
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const paperCard: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

const registerCard = (game: Game, id: number, seat: PlayerSeat = mkPlayerSeat(0)): EntityId => {
  const eid = mkEntityId(id);
  game.cards.set(eid, new Card(eid, paperCard, seat, seat, ZoneType.Battlefield));
  return eid;
};

const mkReplacement = (id: number, sourceCardId: number): ReplacementAbility => ({
  id: mkEntityId(id),
  kind: "replacement",
  sourceCardId: mkEntityId(sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: id,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches: () => true,
  apply: (i) => i, // non-mutating pass-through
  isSelfReplacement: false,
});

const damage = (amount: number): MutationIntent =>
  ({
    kind: "damage",
    sourceId: mkEntityId(100),
    targetKind: "player",
    targetId: mkPlayerSeat(0),
    amount,
    isCombat: false,
  }) as unknown as MutationIntent;

// Drive the apply-loop with a responder that accepts the suggested order
// OR a caller-supplied permutation.
const runWithOrderResponder = (
  gen: Generator<EngineYield, ApplyResult, unknown>,
  reorder: (ids: readonly EntityId[]) => readonly EntityId[],
): ApplyResult => {
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...reorder(y.request.replacementIds)] });
    } else {
      step = gen.next();
    }
  }
  return step.value;
};

describe("applyReplacementLoop — one-apply property (CR 614.5)", () => {
  it("each replacement id appears at most once in appliedIds regardless of input permutation", () => {
    fc.assert(
      fc.property(
        // Between 1 and 8 replacements.
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 8 }),
        // Permutation seed to drive the ordering decision.
        fc.nat({ max: 1_000_000 }),
        (rawIds, permSeed) => {
          const ids = Array.from(new Set(rawIds));
          const game = mkGame();
          for (const id of ids) {
            const cardId = id + 10_000;
            registerCard(game, cardId);
            game.replacementRegistry.register(mkReplacement(id, cardId));
          }
          // Simple deterministic permutation from the seed (rotate).
          const reorder = (list: readonly EntityId[]): readonly EntityId[] => {
            if (list.length === 0) return list;
            const k = permSeed % list.length;
            return [...list.slice(k), ...list.slice(0, k)];
          };
          const result = runWithOrderResponder(applyReplacementLoop(damage(3), game), reorder);
          expect(result.status).toBe("applied");
          // One-apply invariant: unique ids.
          const set = new Set(result.appliedIds);
          expect(set.size).toBe(result.appliedIds.length);
          // Every registered replacement is in the applied set (all match,
          // all pass-through apply — no prevention).
          expect(set.size).toBe(ids.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("prevention short-circuits the loop — appliedIds still contain no duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 8 }),
        fc.nat({ max: 100 }),
        (rawIds, whichPrevents) => {
          const ids = Array.from(new Set(rawIds));
          if (ids.length < 2) return; // need at least two for a non-trivial prevent test
          const game = mkGame();
          // Pick one id to be the "preventer" that returns null on apply.
          const preventerId = ids[whichPrevents % ids.length];
          if (preventerId === undefined) return;
          for (const id of ids) {
            const cardId = id + 10_000;
            registerCard(game, cardId);
            const r: ReplacementAbility =
              id === preventerId
                ? { ...mkReplacement(id, cardId), apply: () => null }
                : mkReplacement(id, cardId);
            game.replacementRegistry.register(r);
          }
          const result = runWithOrderResponder(applyReplacementLoop(damage(3), game), (l) => l);
          // One-apply invariant still holds even when prevention short-
          // circuits mid-batch: no id appears twice.
          const set = new Set(result.appliedIds);
          expect(set.size).toBe(result.appliedIds.length);
        },
      ),
      { numRuns: 40 },
    );
  });
});

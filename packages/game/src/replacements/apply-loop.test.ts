// SPDX-License-Identifier: GPL-3.0-or-later
// Replacement apply-loop tests — CR 614.1c-d self-precedence + CR 614.5
// one-apply (SP2 Task 18).
import type {
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
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

type ReplOpts = {
  id: number;
  sourceCardId: number;
  matchesFn?: (i: MutationIntent) => boolean;
  applyFn?: (i: MutationIntent) => MutationIntent | null;
};

const mkReplacement = (opts: ReplOpts): ReplacementAbility => ({
  id: mkEntityId(opts.id),
  kind: "replacement",
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches: opts.matchesFn ?? (() => true),
  apply: (i) => (opts.applyFn ?? ((x) => x))(i),
  isSelfReplacement: false,
  layer: "other",
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

const etbIntent = (cardId: EntityId): MutationIntent =>
  ({
    kind: "moveTo",
    cardId,
    toZone: ZoneType.Battlefield,
    toSeat: null,
    cause: "etb",
  }) as unknown as MutationIntent;

// Helper: run generator to completion with an auto-responder that accepts
// the suggested order verbatim. Returns the final ApplyResult and the
// sequence of yields encountered.
const runAcceptingSuggestedOrder = (
  gen: Generator<EngineYield, ApplyResult, unknown>,
): { result: ApplyResult; yields: EngineYield[] } => {
  const yields: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    yields.push(y);
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...y.request.replacementIds] });
    } else {
      // No other yield kinds expected from apply-loop itself; if GameAction
      // were driving, it could emit events, but apply-loop only yields the
      // ordering decision.
      step = gen.next();
    }
  }
  return { result: step.value, yields };
};

describe("applyReplacementLoop (CR 614.1c-d + 614.5)", () => {
  it("no replacements → result applied, final === initial, appliedIds empty", () => {
    const game = mkGame();
    const initial = damage(3);
    const { result, yields } = runAcceptingSuggestedOrder(applyReplacementLoop(initial, game));
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("unreachable");
    expect(result.final).toBe(initial);
    expect(result.appliedIds).toEqual([]);
    expect(yields).toHaveLength(0);
  });

  it("single replacement that mutates → final reflects mutation", () => {
    const game = mkGame();
    game.replacementRegistry.register(
      mkReplacement({
        id: 1,
        sourceCardId: 10,
        applyFn: (i) =>
          ({
            ...(i as unknown as Record<string, unknown>),
            amount: (i as unknown as { amount: number }).amount + 1,
          }) as unknown as MutationIntent,
      }),
    );
    const { result } = runAcceptingSuggestedOrder(applyReplacementLoop(damage(3), game));
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("unreachable");
    expect((result.final as unknown as { amount: number }).amount).toBe(4);
    expect(result.appliedIds).toEqual([mkEntityId(1)]);
  });

  it("single replacement that prevents → status prevented, original preserved", () => {
    const game = mkGame();
    game.replacementRegistry.register(mkReplacement({ id: 1, sourceCardId: 10, applyFn: () => null }));
    const initial = damage(3);
    const { result } = runAcceptingSuggestedOrder(applyReplacementLoop(initial, game));
    expect(result.status).toBe("prevented");
    if (result.status !== "prevented") throw new Error("unreachable");
    expect(result.original).toBe(initial);
    expect(result.appliedIds).toEqual([mkEntityId(1)]);
  });

  it("two replacements applied in order → both in appliedIds, final reflects both", () => {
    const game = mkGame();
    game.replacementRegistry.register(
      mkReplacement({
        id: 1,
        sourceCardId: 10,
        applyFn: (i) =>
          ({
            ...(i as unknown as Record<string, unknown>),
            amount: (i as unknown as { amount: number }).amount + 1,
          }) as unknown as MutationIntent,
      }),
    );
    game.replacementRegistry.register(
      mkReplacement({
        id: 2,
        sourceCardId: 11,
        applyFn: (i) =>
          ({
            ...(i as unknown as Record<string, unknown>),
            amount: (i as unknown as { amount: number }).amount * 2,
          }) as unknown as MutationIntent,
      }),
    );
    const { result, yields } = runAcceptingSuggestedOrder(applyReplacementLoop(damage(3), game));
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("unreachable");
    // First +1 → 4, then *2 → 8 (suggested order is [1, 2]).
    expect((result.final as unknown as { amount: number }).amount).toBe(8);
    expect(result.appliedIds).toEqual([mkEntityId(1), mkEntityId(2)]);
    // One ordering decision yielded (2 applicable on the first gather,
    // none remaining after both applied).
    expect(yields).toHaveLength(1);
    if (yields[0]?.kind !== "decision") throw new Error("expected decision");
  });

  it("ETB with 1 self + 1 external → self applies first, then external", () => {
    const game = mkGame();
    const cardId = registerCard(game, 10);
    const order: string[] = [];
    game.replacementRegistry.register(
      mkReplacement({
        id: 1,
        // external: sourceCardId !== intent.cardId
        sourceCardId: 20,
        applyFn: (i) => {
          order.push("external");
          return i;
        },
      }),
    );
    game.replacementRegistry.register(
      mkReplacement({
        id: 2,
        // self: sourceCardId === intent.cardId (10)
        sourceCardId: 10,
        applyFn: (i) => {
          order.push("self");
          return i;
        },
      }),
    );
    const { result } = runAcceptingSuggestedOrder(applyReplacementLoop(etbIntent(cardId), game));
    expect(result.status).toBe("applied");
    // Self fires before external.
    expect(order).toEqual(["self", "external"]);
  });

  it("ETB with 2 self + 1 external → both self ordered via CR 616, then external", () => {
    const game = mkGame();
    const cardId = registerCard(game, 10);
    const order: string[] = [];
    game.replacementRegistry.register(
      mkReplacement({
        id: 1,
        sourceCardId: 10, // self
        applyFn: (i) => {
          order.push("self-1");
          return i;
        },
      }),
    );
    game.replacementRegistry.register(
      mkReplacement({
        id: 2,
        sourceCardId: 10, // self
        applyFn: (i) => {
          order.push("self-2");
          return i;
        },
      }),
    );
    game.replacementRegistry.register(
      mkReplacement({
        id: 3,
        sourceCardId: 99, // external
        applyFn: (i) => {
          order.push("external");
          return i;
        },
      }),
    );
    const gen = applyReplacementLoop(etbIntent(cardId), game);
    // First gather: 3 applicable. ETB partition → self batch of 2; CR 616
    // yields an ordering decision for the self batch.
    let step = gen.next();
    const yieldedDecisions: EngineYield[] = [];
    while (!step.done) {
      yieldedDecisions.push(step.value);
      if (step.value.kind === "decision" && step.value.request.kind === "orderReplacements") {
        step = gen.next({ order: [...step.value.request.replacementIds] });
      } else {
        step = gen.next();
      }
    }
    // One ordering decision yielded: the self batch has 2 applicable and
    // needs ordering via CR 616. The external batch on the next iteration
    // has only 1 applicable so the orderer skips the yield (fast path).
    expect(yieldedDecisions).toHaveLength(1);
    // Self fires before external — partition order is preserved across
    // iterations of the re-gather loop.
    expect(order).toEqual(["self-1", "self-2", "external"]);
    if (step.value.status !== "applied") throw new Error("expected applied");
  });

  it("CR 614.5 one-apply: a replacement doesn't reapply on re-gather even if still matching", () => {
    const game = mkGame();
    let callCount = 0;
    game.replacementRegistry.register(
      mkReplacement({
        id: 1,
        sourceCardId: 10,
        // matches always; apply is an identity (intent doesn't change),
        // so without CR 614.5 the loop would spin forever.
        matchesFn: () => true,
        applyFn: (i) => {
          callCount++;
          return i;
        },
      }),
    );
    const { result } = runAcceptingSuggestedOrder(applyReplacementLoop(damage(3), game));
    expect(result.status).toBe("applied");
    // Called exactly once despite matches() returning true forever.
    expect(callCount).toBe(1);
    if (result.status !== "applied") throw new Error("unreachable");
    expect(result.appliedIds).toEqual([mkEntityId(1)]);
  });

  it("re-gather picks up a replacement that becomes applicable mid-loop", () => {
    const game = mkGame();
    // Replacement A: adds 5 to amount. Only applies when amount < 10.
    game.replacementRegistry.register(
      mkReplacement({
        id: 1,
        sourceCardId: 10,
        matchesFn: (i) => (i as unknown as { amount: number }).amount < 10,
        applyFn: (i) =>
          ({
            ...(i as unknown as Record<string, unknown>),
            amount: (i as unknown as { amount: number }).amount + 5,
          }) as unknown as MutationIntent,
      }),
    );
    // Replacement B: halves amount. Only applies when amount >= 8.
    game.replacementRegistry.register(
      mkReplacement({
        id: 2,
        sourceCardId: 11,
        matchesFn: (i) => (i as unknown as { amount: number }).amount >= 8,
        applyFn: (i) =>
          ({
            ...(i as unknown as Record<string, unknown>),
            amount: Math.floor((i as unknown as { amount: number }).amount / 2),
          }) as unknown as MutationIntent,
      }),
    );
    // Initial damage(3): only A matches; after A amount=8, B matches; after
    // B amount=4, A already applied so excluded. Final: 4.
    const { result, yields } = runAcceptingSuggestedOrder(applyReplacementLoop(damage(3), game));
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("unreachable");
    expect((result.final as unknown as { amount: number }).amount).toBe(4);
    expect(result.appliedIds).toEqual([mkEntityId(1), mkEntityId(2)]);
    // Two iterations, each with 1 applicable → no ordering decision yielded
    // (single-item batches skip the yield per the orderer).
    expect(yields).toHaveLength(0);
  });

  it("non-ETB intent: self and external are a single mixed batch (no precedence)", () => {
    const game = mkGame();
    // Damage intent has no cardId, so sameSource() is false for all
    // replacements — partitioning is a no-op. Verify by registering a
    // replacement sharing source with the intent's "cardId" field that
    // doesn't exist, and ensuring ordering request includes all three.
    game.replacementRegistry.register(mkReplacement({ id: 1, sourceCardId: 10 }));
    game.replacementRegistry.register(mkReplacement({ id: 2, sourceCardId: 11 }));
    game.replacementRegistry.register(mkReplacement({ id: 3, sourceCardId: 12 }));
    const gen = applyReplacementLoop(damage(3), game);
    const first = gen.next();
    if (first.done || first.value.kind !== "decision") {
      throw new Error("expected decision yield");
    }
    if (first.value.request.kind !== "orderReplacements") {
      throw new Error("expected orderReplacements");
    }
    // All three in one batch (not partitioned).
    expect(first.value.request.replacementIds).toHaveLength(3);
    gen.next({ order: [...first.value.request.replacementIds] });
  });
});

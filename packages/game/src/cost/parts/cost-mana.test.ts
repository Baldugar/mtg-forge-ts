// SPDX-License-Identifier: GPL-3.0-or-later
import { Color, ManaProduced, SeededRng, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
import { CostMana } from "./cost-mana.js";
import type { CostPaymentContext } from "./cost-part.js";

// Minimal two-player Game for cost tests.
const makeGame = (): Game =>
  new Game({
    lobbyPlayers: [
      { id: "p0", name: "P0", controllerKind: "human" },
      { id: "p1", name: "P1", controllerKind: "human" },
    ],
    rules: {
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
    },
    meta: {
      engineVersion: "0.0.0",
      forgeSha: "test",
      cardDataSyncedAt: "2026-04-24T00:00:00Z",
      crVersion: "2024-11-08",
      seed: "42",
    },
    rng: new SeededRng(42n),
  });

function driveGenerator<T>(gen: Generator<unknown, T, unknown>): T {
  let result = gen.next();
  while (!result.done) {
    result = gen.next();
  }
  return result.value;
}

describe("CostMana", () => {
  it("handlerKey is Mana", () => {
    expect(CostMana.handlerKey).toBe("Mana");
  });

  it("canPay returns false when pool has fewer shards than CMC", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    player.manaPool = pool;
    // Pool is empty; "R" has CMC=1
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };
    expect(CostMana.canPay(ctx)).toBe(false);
  });

  it("canPay returns true when pool has enough shards", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };
    expect(CostMana.canPay(ctx)).toBe(true);
  });

  it("pay drains shards equal to CMC and returns a receipt", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };

    const receipt = driveGenerator(CostMana.pay(ctx));
    expect(receipt.handlerKey).toBe("Mana");
    expect(receipt.raw).toBe("R");
    // Pool should have 1 shard remaining (CMC=1 drained)
    expect(pool.size()).toBe(1);
  });

  it("pay throws when pool has insufficient mana", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    // Pool empty, cost "R" has CMC=1
    player.manaPool = pool;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };

    expect(() => driveGenerator(CostMana.pay(ctx))).toThrow(/insufficient mana/);
  });

  it("undo restores the pre-payment pool state", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    const red = ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) });
    pool.add(red);
    player.manaPool = pool;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };

    const receipt = driveGenerator(CostMana.pay(ctx));
    expect(pool.size()).toBe(0); // drained

    CostMana.undo(receipt, ctx);
    expect(pool.size()).toBe(1); // restored
    expect(pool.toArray()[0]?.color).toBe(Color.Red);
  });
});

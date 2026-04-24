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

  it("canPay returns false when pool cannot satisfy cost color", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green)); // G, not R
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };
    // G cannot satisfy R pip
    expect(CostMana.canPay(ctx)).toBe(false);
  });

  it("canPay returns false when pool is empty", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "R",
    };
    expect(CostMana.canPay(ctx)).toBe(false);
  });

  it("canPay returns true when pool has matching color", () => {
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

  it("canPay returns true for '1R' when pool has [R, G]", () => {
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
      raw: "1R",
    };
    expect(CostMana.canPay(ctx)).toBe(true);
  });

  it("canPay returns false for '1R' when pool has only [G]", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "1R",
    };
    // Only 1 mana, but it's the wrong color for the colored pip
    expect(CostMana.canPay(ctx)).toBe(false);
  });

  it("pay drains the correct matching shard and returns a receipt", () => {
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
    // Pool should have 1 shard remaining (R consumed, G left)
    expect(pool.size()).toBe(1);
    expect(pool.toArray()[0]?.color).toBe(Color.Green);
  });

  it("pay throws when pool cannot pay the cost color", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
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

  it("pay with '1R' drains R for colored pip and G for generic pip", () => {
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
      raw: "1R",
    };

    driveGenerator(CostMana.pay(ctx));
    // Both entries consumed
    expect(pool.size()).toBe(0);
  });

  it("pay for phyrexian cost 'W/P' from empty pool deducts 2 life", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    player.manaPool = pool;
    const initialLife = player.life;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "W/P",
    };

    driveGenerator(CostMana.pay(ctx));
    expect(player.life).toBe(initialLife - 2);
    expect(pool.size()).toBe(0);
  });

  it("undo after phyrexian payment restores life", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    player.manaPool = pool;
    const initialLife = player.life;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "W/P",
    };

    const receipt = driveGenerator(CostMana.pay(ctx));
    expect(player.life).toBe(initialLife - 2);

    CostMana.undo(receipt, ctx);
    expect(player.life).toBe(initialLife);
  });

  it("canPay returns true for phyrexian 'W/P' with empty pool (life fallback)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "W/P",
    };
    // Phyrexian cost can always be paid with life
    expect(CostMana.canPay(ctx)).toBe(true);
  });

  it("pay for hybrid 'W/U' with [U] in pool drains U", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Blue, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "W/U",
    };

    driveGenerator(CostMana.pay(ctx));
    expect(pool.size()).toBe(0);
  });
});

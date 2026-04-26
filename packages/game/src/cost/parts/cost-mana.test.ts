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

/**
 * Drive a generator to completion, optionally supplying responses to yields.
 * `responses` is a queue: each time the generator yields, if a response is
 * available it is sent back via .next(response); otherwise undefined is sent.
 */
function driveGenerator<T>(gen: Generator<unknown, T, unknown>, responses: unknown[] = []): T {
  let result = gen.next();
  while (!result.done) {
    const resp = responses.shift();
    result = gen.next(resp);
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

  // ---- X-cost tests (T49) ------------------------------------------------

  it("canPay returns true for X cost 'X' with empty pool (X=0 trivially payable)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "X",
    };
    // X=0 is always payable
    expect(CostMana.canPay(ctx)).toBe(true);
  });

  it("pay for 'X' cost yields chooseX decision with correct maxX", () => {
    // Pool has 3 mana; X cost has no other pips → maxX = 3.
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "X",
    };

    // Drive the generator; capture yields.
    const yields: unknown[] = [];
    const gen = CostMana.pay(ctx);
    let step = gen.next();
    // First yield should be the chooseX decision.
    expect(step.done).toBe(false);
    yields.push(step.value);

    const yielded = step.value as { kind: string; request: { kind: string; maxX: number } };
    expect(yielded.kind).toBe("decision");
    expect(yielded.request.kind).toBe("chooseX");
    expect(yielded.request.maxX).toBe(3);

    // Send back x=0 (choose X=0, simplest case).
    step = gen.next({ kind: "chooseX", x: 0 });
    // With X=0, no pips to pay — generator should complete.
    while (!step.done) {
      step = gen.next();
    }
    // X=0 with no other pips: pool untouched.
    expect(pool.size()).toBe(3);
  });

  it("pay for 'XR' with X=3 from pool [R, G, G, G, G] drains 4 entries", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) })); // extra
    player.manaPool = pool;

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "XR",
    };

    // Respond to chooseX with x=3. Pool has 5 entries; maxX = 5 - 1(R) = 4.
    const receipt = driveGenerator(CostMana.pay(ctx), [{ kind: "chooseX", x: 3 }]);
    expect(receipt.handlerKey).toBe("Mana");
    // 1 R (colored pip) + 3 generic (X=3) = 4 consumed, 1 extra G remains.
    expect(pool.size()).toBe(1);
    expect((receipt.payload as { xValue: number }).xValue).toBe(3);
  });

  // -------------------------------------------------------------------
  // Wave 30 — Powerstone solver-side restriction (closes Wave 29D partial).
  // -------------------------------------------------------------------
  it("Powerstone {C} cannot pay for a creature spell's generic pip", async () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    // Powerstone {C} (restricted) + Forest's {G} (unrestricted).
    pool.add(ManaProduced.colorless({ restriction: "nonCreatureNonActivated" }));
    pool.add(ManaProduced.colored(Color.Green));
    player.manaPool = pool;

    // Synthesize a creature card so buildEntryFilter sees CardType.Creature.
    const { Card } = await import("../../card.js");
    const { CardType, DEFAULT_PAPER_CARD_FLAGS, TypeLine, ColorSet, ZoneType } = await import(
      "@mtg-forge-ts/core"
    );
    const types = new TypeLine([], [CardType.Creature], ["Bear"]);
    const def = {
      name: "Bear",
      oracle: "",
      types,
      manaCost: { raw: "1G" },
      pt: { power: "2", toughness: "2" },
      colors: ColorSet.of(Color.Green),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    };
    const paper = {
      name: "Bear",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const cardId = mkEntityId(50);
    game.cards.set(cardId, new Card(cardId, paper, seat, seat, ZoneType.Hand));

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "1 G",
      kind: "spell",
    };
    // Cost is {1}{G}. Pool has Powerstone {C} + Forest {G}. The {1} pip
    // must NOT be paid by Powerstone {C} (creature spell restriction).
    // {G} is paid by Forest. {1} cannot be paid: solver returns null.
    expect(CostMana.canPay(ctx)).toBe(false);
  });

  it("Powerstone {C} CAN pay a non-creature spell's generic pip", async () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless({ restriction: "nonCreatureNonActivated" }));
    pool.add(ManaProduced.colored(Color.Green));
    player.manaPool = pool;

    const { Card } = await import("../../card.js");
    const { CardType, DEFAULT_PAPER_CARD_FLAGS, TypeLine, ColorSet, ZoneType } = await import(
      "@mtg-forge-ts/core"
    );
    const types = new TypeLine([], [CardType.Sorcery], []);
    const def = {
      name: "Sorcery",
      oracle: "",
      types,
      manaCost: { raw: "1G" },
      colors: ColorSet.of(Color.Green),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    };
    const paper = {
      name: "Sorcery",
      edition: "TST",
      collectorNumber: "2",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const cardId = mkEntityId(51);
    game.cards.set(cardId, new Card(cardId, paper, seat, seat, ZoneType.Hand));

    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "1 G",
      kind: "spell",
    };
    // Non-creature: Powerstone {C} legal for {1}. Should succeed.
    expect(CostMana.canPay(ctx)).toBe(true);
  });
});

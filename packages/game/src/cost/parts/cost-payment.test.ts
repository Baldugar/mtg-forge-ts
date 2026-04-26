// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for CostPayLife, CostSacrifice, parseCostString, payCost, undoCost.
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
import type { CostPaymentContext } from "./cost-part.js";
import { CostPayLife } from "./cost-pay-life.js";
import { parseCostString, payCost, undoCost } from "./cost-payment.js";
import { CostSacrifice } from "./cost-sacrifice.js";

// Import all parts so they self-register
import "./cost-mana.js";
import "./cost-tap.js";
import "./cost-pay-life.js";
import "./cost-sacrifice.js";

const samplePaper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

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

// ──────────────────────────────────────────────────────────────
// CostPayLife
// ──────────────────────────────────────────────────────────────
describe("CostPayLife", () => {
  it("handlerKey is PayLife", () => {
    expect(CostPayLife.handlerKey).toBe("PayLife");
  });

  it("canPay returns true when player has enough life", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    game.getPlayer(seat).life = 20;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "3 life",
    };
    expect(CostPayLife.canPay(ctx)).toBe(true);
  });

  it("canPay returns false when player has insufficient life", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    game.getPlayer(seat).life = 2;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "3 life",
    };
    expect(CostPayLife.canPay(ctx)).toBe(false);
  });

  it("pay deducts life and returns a receipt", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    game.getPlayer(seat).life = 20;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "3 life",
    };
    const receipt = driveGenerator(CostPayLife.pay(ctx));
    expect(game.getPlayer(seat).life).toBe(17);
    expect(receipt.handlerKey).toBe("PayLife");
    expect((receipt.payload as { lifePaid: number }).lifePaid).toBe(3);
  });

  it("pay throws when player has insufficient life", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    game.getPlayer(seat).life = 1;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "3 life",
    };
    expect(() => driveGenerator(CostPayLife.pay(ctx))).toThrow(/insufficient life/);
  });

  it("undo refunds life directly (no events)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    game.getPlayer(seat).life = 20;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "3 life",
    };
    const receipt = driveGenerator(CostPayLife.pay(ctx));
    expect(game.getPlayer(seat).life).toBe(17);
    CostPayLife.undo(receipt, ctx);
    expect(game.getPlayer(seat).life).toBe(20);
  });
});

// ──────────────────────────────────────────────────────────────
// CostSacrifice
// ──────────────────────────────────────────────────────────────
describe("CostSacrifice", () => {
  it("handlerKey is Sacrifice", () => {
    expect(CostSacrifice.handlerKey).toBe("Sacrifice");
  });

  it("canPay returns true (M4 stub — no grammar check)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "Sac Creature",
    };
    expect(CostSacrifice.canPay(ctx)).toBe(true);
  });

  it("pay throws NotImplemented (deferred to Part D)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(1),
      raw: "Sac Creature",
    };
    expect(() => driveGenerator(CostSacrifice.pay(ctx))).toThrow(/deferred to Part D/);
  });
});

// ──────────────────────────────────────────────────────────────
// parseCostString
// ──────────────────────────────────────────────────────────────
describe("parseCostString", () => {
  it("parses a single mana symbol to a Mana part", () => {
    const plan = parseCostString("R");
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ handlerKey: "Mana", raw: "R" });
  });

  it("parses T to a Tap part", () => {
    const plan = parseCostString("T");
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ handlerKey: "Tap", raw: "T" });
  });

  it("parses '2 R, T, 2 life' to 3 parts [Mana, Tap, PayLife]", () => {
    const plan = parseCostString("2 R, T, 2 life");
    expect(plan.parts).toHaveLength(3);
    expect(plan.parts[0]).toMatchObject({ handlerKey: "Mana", raw: "2 R" });
    expect(plan.parts[1]).toMatchObject({ handlerKey: "Tap", raw: "T" });
    expect(plan.parts[2]).toMatchObject({ handlerKey: "PayLife", raw: "2 life" });
  });

  it("parses 'Sac Creature' to a Sacrifice part", () => {
    const plan = parseCostString("Sac Creature");
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ handlerKey: "Sacrifice", raw: "Sac Creature" });
  });

  it("parses Q as Untap (Wave 46)", () => {
    const plan = parseCostString("Q");
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ handlerKey: "Untap", raw: "Q" });
  });

  it("throws for unrecognized cost segment", () => {
    expect(() => parseCostString("foobar")).toThrow(/unsupported cost segment/);
  });

  it("returns empty parts for empty string", () => {
    const plan = parseCostString("");
    expect(plan.parts).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────
// payCost + undoCost orchestrator
// ──────────────────────────────────────────────────────────────
describe("payCost / undoCost orchestrator", () => {
  it("pays a single mana cost and returns receipt list of length 1", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;

    const cardId = mkEntityId(1);
    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "" };
    const plan = parseCostString("R");
    const receipts = driveGenerator(payCost(plan, ctx));

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.handlerKey).toBe("Mana");
    expect(pool.size()).toBe(0); // drained
  });

  it("undoCost refunds mana (LIFO rollback of single part)", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;

    const cardId = mkEntityId(1);
    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "" };
    const plan = parseCostString("R");
    const receipts = driveGenerator(payCost(plan, ctx));
    expect(pool.size()).toBe(0);

    undoCost(receipts, ctx);
    expect(pool.size()).toBe(1); // refunded
  });

  it("pays multiple parts in order and undo reverses them", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const player = game.getPlayer(seat);

    // Set up mana pool for the R cost
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;

    // Set up card for the tap cost
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    card.tapped = false;
    game.cards.set(cardId, card);

    // Also set up life (CostPayLife portion)
    player.life = 20;

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "" };
    // "R, T" — 2 parts (skip PayLife for this test to keep it simple)
    const plan = parseCostString("R, T");
    const receipts = driveGenerator(payCost(plan, ctx));

    expect(receipts).toHaveLength(2);
    expect(pool.size()).toBe(0); // mana drained
    expect(card.tapped).toBe(true); // card tapped

    // Undo in LIFO: untap first (Tap was last), then refund mana
    undoCost(receipts, ctx);
    expect(pool.size()).toBe(1); // mana refunded
    expect(card.tapped).toBe(false); // untapped
  });
});

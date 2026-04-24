// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { Game } from "../../game.js";
import type { CostPaymentContext } from "./cost-part.js";
import { CostTap } from "./cost-tap.js";

const samplePaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "176",
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

describe("CostTap", () => {
  it("handlerKey is Tap", () => {
    expect(CostTap.handlerKey).toBe("Tap");
  });

  it("canPay returns true for an untapped card", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    card.tapped = false;
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "T" };
    expect(CostTap.canPay(ctx)).toBe(true);
  });

  it("canPay returns false for a tapped card", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    card.tapped = true;
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "T" };
    expect(CostTap.canPay(ctx)).toBe(false);
  });

  it("canPay returns false when card does not exist", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(999),
      raw: "T",
    };
    expect(CostTap.canPay(ctx)).toBe(false);
  });

  it("pay taps the card and returns a receipt with card id", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    card.tapped = false;
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "T" };
    const receipt = driveGenerator(CostTap.pay(ctx));

    expect(card.tapped).toBe(true);
    expect(receipt.handlerKey).toBe("Tap");
    expect((receipt.payload as { cardId: number }).cardId).toBe(cardId);
  });

  it("pay throws when the card is already tapped", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    card.tapped = true;
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "T" };
    expect(() => driveGenerator(CostTap.pay(ctx))).toThrow(/already tapped/);
  });

  it("undo sets card.tapped to false without generating events", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    card.tapped = false;
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "T" };
    const receipt = driveGenerator(CostTap.pay(ctx));
    expect(card.tapped).toBe(true);

    const events: unknown[] = [];
    for (const ev of (game as unknown as { _events?: unknown[] })._events ?? []) {
      events.push(ev);
    }

    CostTap.undo(receipt, ctx);
    expect(card.tapped).toBe(false);
  });
});

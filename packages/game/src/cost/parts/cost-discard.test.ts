// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { PaperCard } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { Game } from "../../game.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { CostDiscard } from "./cost-discard.js";
import type { CostPaymentContext } from "./cost-part.js";
import { parseCostString } from "./cost-payment.js";

// Register CostDiscard side-effect (already happens on import above)

const samplePaper: PaperCard = {
  name: "Forgotten Cave",
  edition: "ONS",
  collectorNumber: "310",
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

function addZones(game: Game, seat: ReturnType<typeof mkPlayerSeat>): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
}

function driveGenerator<T>(gen: Generator<unknown, T, unknown>): T {
  let result = gen.next();
  while (!result.done) {
    result = gen.next();
  }
  return result.value;
}

describe("CostDiscard", () => {
  it("handlerKey is Discard", () => {
    expect(CostDiscard.handlerKey).toBe("Discard");
  });

  it("canPay returns true when source card is in hand", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addZones(game, seat);
    const cardId = mkEntityId(10);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "Discard CARDNAME" };
    expect(CostDiscard.canPay(ctx)).toBe(true);
  });

  it("canPay returns false when source card is on battlefield", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addZones(game, seat);
    const cardId = mkEntityId(11);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "Discard CARDNAME" };
    expect(CostDiscard.canPay(ctx)).toBe(false);
  });

  it("canPay returns false when card does not exist", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: mkEntityId(999),
      raw: "Discard CARDNAME",
    };
    expect(CostDiscard.canPay(ctx)).toBe(false);
  });

  it("pay moves the card from hand to graveyard and returns a receipt", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addZones(game, seat);
    const cardId = mkEntityId(12);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    hand.add(cardId);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "Discard CARDNAME" };
    const receipt = driveGenerator(CostDiscard.pay(ctx));

    expect(card.zone).toBe(ZoneType.Graveyard);
    expect(receipt.handlerKey).toBe("Discard");
    expect((receipt.payload as { cardId: number }).cardId).toBe(cardId);
  });

  it("pay throws when the card is not in hand", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addZones(game, seat);
    const cardId = mkEntityId(13);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "Discard CARDNAME" };
    expect(() => driveGenerator(CostDiscard.pay(ctx))).toThrow(/not Hand/);
  });

  it("undo moves card back to hand", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addZones(game, seat);
    const cardId = mkEntityId(14);
    const card = new Card(cardId, samplePaper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    hand.add(cardId);

    const ctx: CostPaymentContext = { game, payerSeat: seat, sourceCardId: cardId, raw: "Discard CARDNAME" };
    const receipt = driveGenerator(CostDiscard.pay(ctx));

    expect(card.zone).toBe(ZoneType.Graveyard);

    CostDiscard.undo(receipt, ctx);
    expect(card.zone).toBe(ZoneType.Hand);
  });

  it("parseCostString('1, Discard CARDNAME') produces Mana + Discard parts", () => {
    // Ensure CostDiscard is registered by importing it
    // Import side effect already done at top of file
    const plan = parseCostString("1, Discard CARDNAME");
    expect(plan.parts).toHaveLength(2);
    expect(plan.parts[0]?.handlerKey).toBe("Mana");
    expect(plan.parts[1]?.handlerKey).toBe("Discard");
  });

  it("parseCostString('R, Discard CARDNAME') produces Mana + Discard parts", () => {
    const plan = parseCostString("R, Discard CARDNAME");
    expect(plan.parts).toHaveLength(2);
    expect(plan.parts[0]?.handlerKey).toBe("Mana");
    expect(plan.parts[1]?.handlerKey).toBe("Discard");
  });
});

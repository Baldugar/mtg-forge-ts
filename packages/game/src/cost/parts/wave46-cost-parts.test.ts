// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 46 — cost-system completion test pack. Covers all the new CostPart
// kinds plus the parseCostString routing additions.
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { CardDefinition, DecisionResponse, EntityId, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { CostDamage } from "./cost-damage.js";
import { CostDraw } from "./cost-draw.js";
import { CostExile } from "./cost-exile.js";
import { CostMill } from "./cost-mill.js";
import type { CostPaymentContext } from "./cost-part.js";
import { CostPayEnergy } from "./cost-pay-energy.js";
import { parseCostString } from "./cost-payment.js";
import { CostPutCounter } from "./cost-put-counter.js";
import { CostRemoveCounter } from "./cost-remove-counter.js";
import { CostReturn } from "./cost-return.js";
import { CostReveal } from "./cost-reveal.js";
import { CostTapType } from "./cost-tap-type.js";
import { CostUntap } from "./cost-untap.js";

const samplePaper: PaperCard = {
  name: "Test Card",
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkCreatureDef = (name: string): CardDefinition => ({
  name,
  oracle: "",
  types: TypeLine.parse("Creature — Bear"),
  manaCost: null,
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

const mkCreaturePaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: mkCreatureDef(name),
});

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

function addAllZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, seat));
}

function placeCard(
  game: Game,
  id: EntityId,
  seat: PlayerSeat,
  zone: ZoneType,
  paper: PaperCard = samplePaper,
): Card {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const player = game.getPlayer(seat);
  const z = player.zones.get(zone);
  if (z) z.add(id);
  return card;
}

function driveNoDecisions<T>(gen: Generator<unknown, T, unknown>): T {
  let result = gen.next();
  while (!result.done) {
    result = gen.next();
  }
  return result.value;
}

function driveWithChoose<T>(gen: Generator<unknown, T, unknown>, chosen: readonly EntityId[]): T {
  let result = gen.next();
  while (!result.done) {
    const yielded = result.value as { kind?: string; request?: { kind?: string } };
    if (yielded.kind === "decision" && yielded.request?.kind === "chooseCard") {
      const response: DecisionResponse = { kind: "chooseCard", chosen };
      result = gen.next(response);
    } else {
      result = gen.next();
    }
  }
  return result.value;
}

// ──────────────────────────────────────────────────────────────
// CostPutCounter — AddCounter<n/LOYALTY>
// ──────────────────────────────────────────────────────────────

describe("CostPutCounter", () => {
  it("AddCounter<2/LOYALTY>: pay adds 2 loyalty counters to the source", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(10);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "AddCounter<2/LOYALTY>",
    };
    expect(CostPutCounter.canPay(ctx)).toBe(true);
    const receipt = driveNoDecisions(CostPutCounter.pay(ctx));
    expect(card.counters.get(CounterType.Loyalty)).toBe(2);
    expect(receipt.handlerKey).toBe("PutCounter");
  });

  it("AddCounter<1/P1P1>: pay adds +1/+1 counter shorthand", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(11);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "AddCounter<1/P1P1>",
    };
    driveNoDecisions(CostPutCounter.pay(ctx));
    expect(card.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
  });

  it("undo removes the counters added by pay", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(12);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "AddCounter<3/LOYALTY>",
    };
    const receipt = driveNoDecisions(CostPutCounter.pay(ctx));
    expect(card.counters.get(CounterType.Loyalty)).toBe(3);
    CostPutCounter.undo(receipt, ctx);
    expect(card.counters.get(CounterType.Loyalty)).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────
// CostRemoveCounter — SubCounter<n/LOYALTY>
// ──────────────────────────────────────────────────────────────

describe("CostRemoveCounter", () => {
  it("SubCounter<3/LOYALTY>: canPay false when insufficient", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(20);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    card.counters.set(CounterType.Loyalty, 2);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "SubCounter<3/LOYALTY>",
    };
    expect(CostRemoveCounter.canPay(ctx)).toBe(false);
  });

  it("SubCounter<1/LOYALTY>: pay removes 1 loyalty counter", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(21);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    card.counters.set(CounterType.Loyalty, 4);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "SubCounter<1/LOYALTY>",
    };
    expect(CostRemoveCounter.canPay(ctx)).toBe(true);
    driveNoDecisions(CostRemoveCounter.pay(ctx));
    expect(card.counters.get(CounterType.Loyalty)).toBe(3);
  });

  it("SubCounter<1/P1P1>: Walking Ballista shape", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(22);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    card.counters.set(CounterType.PlusOnePlusOne, 2);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "SubCounter<1/P1P1>",
    };
    driveNoDecisions(CostRemoveCounter.pay(ctx));
    expect(card.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
  });

  it("undo restores the removed counters", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(23);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    card.counters.set(CounterType.Loyalty, 5);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "SubCounter<2/LOYALTY>",
    };
    const receipt = driveNoDecisions(CostRemoveCounter.pay(ctx));
    expect(card.counters.get(CounterType.Loyalty)).toBe(3);
    CostRemoveCounter.undo(receipt, ctx);
    expect(card.counters.get(CounterType.Loyalty)).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────
// CostExile (generalized)
// ──────────────────────────────────────────────────────────────

describe("CostExile", () => {
  it("Exile<1/Creature.YouCtrl>: pay moves chosen creature to Exile", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(30);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const targetId = mkEntityId(31);
    const target = placeCard(game, targetId, seat, ZoneType.Battlefield, mkCreaturePaper("Bear"));
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Exile<1/Creature.YouCtrl>",
    };
    expect(CostExile.canPay(ctx)).toBe(true);
    driveWithChoose(CostExile.pay(ctx), [targetId]);
    expect(target.zone).toBe(ZoneType.Exile);
  });

  it("ExileFromGrave<2/Card>: Grim Lavamancer shape — exiles 2 grave cards", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(40);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const a = mkEntityId(41);
    const b = mkEntityId(42);
    const c = mkEntityId(43);
    const cardA = placeCard(game, a, seat, ZoneType.Graveyard);
    const cardB = placeCard(game, b, seat, ZoneType.Graveyard);
    placeCard(game, c, seat, ZoneType.Graveyard);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "ExileFromGrave<2/Card>",
    };
    expect(CostExile.canPay(ctx)).toBe(true);
    driveWithChoose(CostExile.pay(ctx), [a, b]);
    expect(cardA.zone).toBe(ZoneType.Exile);
    expect(cardB.zone).toBe(ZoneType.Exile);
  });

  it("ExileFromTop<3/Card>: exiles top 3 of library", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(50);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const ids = [51, 52, 53, 54].map((n) => mkEntityId(n));
    const cards = ids.map((id) => placeCard(game, id, seat, ZoneType.Library));
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "ExileFromTop<3/Card>",
    };
    expect(CostExile.canPay(ctx)).toBe(true);
    driveNoDecisions(CostExile.pay(ctx));
    // Top 3 now in exile.
    const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
    expect(lib?.size).toBe(1);
    expect(cards[0]?.zone).toBe(ZoneType.Exile);
  });

  it("ExileFromHand<1/Card>: exiles a chosen hand card", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(60);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const handId = mkEntityId(61);
    const handCard = placeCard(game, handId, seat, ZoneType.Hand);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "ExileFromHand<1/Card>",
    };
    expect(CostExile.canPay(ctx)).toBe(true);
    driveWithChoose(CostExile.pay(ctx), [handId]);
    expect(handCard.zone).toBe(ZoneType.Exile);
  });
});

// ──────────────────────────────────────────────────────────────
// CostPayEnergy
// ──────────────────────────────────────────────────────────────

describe("CostPayEnergy", () => {
  it("canPay false when insufficient energy", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(70);
    placeCard(game, cardId, seat, ZoneType.Battlefield);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "PayEnergy<2>",
    };
    expect(CostPayEnergy.canPay(ctx)).toBe(false);
  });

  it("pay deducts the energy from the player", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(71);
    placeCard(game, cardId, seat, ZoneType.Battlefield);
    const player = game.getPlayer(seat);
    player.counters.set(CounterType.Energy, 5);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "PayEnergy<3>",
    };
    expect(CostPayEnergy.canPay(ctx)).toBe(true);
    const receipt = driveNoDecisions(CostPayEnergy.pay(ctx));
    expect(player.counters.get(CounterType.Energy)).toBe(2);
    CostPayEnergy.undo(receipt, ctx);
    expect(player.counters.get(CounterType.Energy)).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────
// CostMill
// ──────────────────────────────────────────────────────────────

describe("CostMill", () => {
  it("Mill<2>: pay mills 2 cards from controller's library", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(80);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const ids = [81, 82, 83].map((n) => mkEntityId(n));
    for (const id of ids) placeCard(game, id, seat, ZoneType.Library);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Mill<2>",
    };
    expect(CostMill.canPay(ctx)).toBe(true);
    driveNoDecisions(CostMill.pay(ctx));
    const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
    const grave = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    expect(lib?.size).toBe(1);
    expect(grave?.size).toBe(2);
  });

  it("Mill<3/Card>: filter form parses + executes", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(90);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    for (const n of [91, 92, 93, 94]) placeCard(game, mkEntityId(n), seat, ZoneType.Library);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Mill<3/Card>",
    };
    expect(CostMill.canPay(ctx)).toBe(true);
    driveNoDecisions(CostMill.pay(ctx));
    expect(game.getPlayer(seat).zones.get(ZoneType.Graveyard)?.size).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────
// CostDraw
// ──────────────────────────────────────────────────────────────

describe("CostDraw", () => {
  it("Draw<1/You>: Smuggler's Copter shape — draws 1 card", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(100);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    placeCard(game, mkEntityId(101), seat, ZoneType.Library);
    placeCard(game, mkEntityId(102), seat, ZoneType.Library);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Draw<1/You>",
    };
    expect(CostDraw.canPay(ctx)).toBe(true);
    driveNoDecisions(CostDraw.pay(ctx));
    expect(game.getPlayer(seat).zones.get(ZoneType.Hand)?.size).toBe(1);
  });

  it("canPay false when library has fewer cards than requested", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(110);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Draw<3/You>",
    };
    expect(CostDraw.canPay(ctx)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// CostDamage
// ──────────────────────────────────────────────────────────────

describe("CostDamage", () => {
  it("DamageYou<2>: pay deals 2 damage to controller", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(120);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const player = game.getPlayer(seat);
    const startLife = player.life;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "DamageYou<2>",
    };
    expect(CostDamage.canPay(ctx)).toBe(true);
    driveNoDecisions(CostDamage.pay(ctx));
    expect(player.life).toBe(startLife - 2);
  });
});

// ──────────────────────────────────────────────────────────────
// CostUntap
// ──────────────────────────────────────────────────────────────

describe("CostUntap", () => {
  it("Q: pay untaps a tapped source", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(130);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    card.tapped = true;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "Q",
    };
    expect(CostUntap.canPay(ctx)).toBe(true);
    const receipt = driveNoDecisions(CostUntap.pay(ctx));
    expect(card.tapped).toBe(false);
    CostUntap.undo(receipt, ctx);
    expect(card.tapped).toBe(true);
  });

  it("canPay false when source is already untapped", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const cardId = mkEntityId(131);
    const card = placeCard(game, cardId, seat, ZoneType.Battlefield);
    card.tapped = false;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: cardId,
      raw: "Q",
    };
    expect(CostUntap.canPay(ctx)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// CostReveal
// ──────────────────────────────────────────────────────────────

describe("CostReveal", () => {
  it("Reveal<1/Card>: emits CardsRevealed for the chosen card", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(140);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const handId = mkEntityId(141);
    placeCard(game, handId, seat, ZoneType.Hand);
    const events: string[] = [];
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Reveal<1/Card>",
    };
    expect(CostReveal.canPay(ctx)).toBe(true);
    const gen = CostReveal.pay(ctx);
    let result = gen.next();
    while (!result.done) {
      const yielded = result.value as {
        kind?: string;
        event?: { kind?: string };
        request?: { kind?: string };
      };
      if (yielded.kind === "event" && yielded.event?.kind !== undefined) {
        events.push(yielded.event.kind);
        result = gen.next();
      } else if (yielded.kind === "decision" && yielded.request?.kind === "chooseCard") {
        const response: DecisionResponse = { kind: "chooseCard", chosen: [handId] };
        result = gen.next(response);
      } else {
        result = gen.next();
      }
    }
    expect(events).toContain("CardsRevealed");
  });
});

// ──────────────────────────────────────────────────────────────
// CostReturn
// ──────────────────────────────────────────────────────────────

describe("CostReturn", () => {
  it("Return<1/Creature>: bounces the chosen creature to hand", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(150);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const targetId = mkEntityId(151);
    const target = placeCard(game, targetId, seat, ZoneType.Battlefield, mkCreaturePaper("Bear"));
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "Return<1/Creature>",
    };
    expect(CostReturn.canPay(ctx)).toBe(true);
    driveWithChoose(CostReturn.pay(ctx), [targetId]);
    expect(target.zone).toBe(ZoneType.Hand);
  });
});

// ──────────────────────────────────────────────────────────────
// CostTapType
// ──────────────────────────────────────────────────────────────

describe("CostTapType", () => {
  it("tap2Type<Creature>: taps 2 untapped creatures", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const sourceId = mkEntityId(160);
    placeCard(game, sourceId, seat, ZoneType.Battlefield);
    const creatureDef = mkCreaturePaper("Bear");
    const aId = mkEntityId(161);
    const bId = mkEntityId(162);
    const a = placeCard(game, aId, seat, ZoneType.Battlefield, creatureDef);
    const b = placeCard(game, bId, seat, ZoneType.Battlefield, creatureDef);
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: sourceId,
      raw: "tap2Type<Creature>",
    };
    expect(CostTapType.canPay(ctx)).toBe(true);
    driveWithChoose(CostTapType.pay(ctx), [aId, bId]);
    expect(a.tapped).toBe(true);
    expect(b.tapped).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
// parseCostString — Wave 46 routing
// ──────────────────────────────────────────────────────────────

describe("parseCostString — Wave 46 prefixes", () => {
  it("routes AddCounter<2/LOYALTY> to PutCounter", () => {
    const plan = parseCostString("AddCounter<2/LOYALTY>");
    expect(plan.parts[0]?.handlerKey).toBe("PutCounter");
  });

  it("routes SubCounter<3/LOYALTY> to RemoveCounter", () => {
    const plan = parseCostString("SubCounter<3/LOYALTY>");
    expect(plan.parts[0]?.handlerKey).toBe("RemoveCounter");
  });

  it("routes Exile<1/Creature> to Exile", () => {
    const plan = parseCostString("Exile<1/Creature>");
    expect(plan.parts[0]?.handlerKey).toBe("Exile");
  });

  it("routes ExileFromHand<1/Card> to Exile", () => {
    const plan = parseCostString("ExileFromHand<1/Card>");
    expect(plan.parts[0]?.handlerKey).toBe("Exile");
  });

  it("routes ExileFromGrave<2/Card> to Exile (non-self)", () => {
    const plan = parseCostString("ExileFromGrave<2/Card>");
    expect(plan.parts[0]?.handlerKey).toBe("Exile");
  });

  it("routes ExileFromGrave<1/CARDNAME> to legacy ExileFromGrave handler", () => {
    const plan = parseCostString("ExileFromGrave<1/CARDNAME>");
    expect(plan.parts[0]?.handlerKey).toBe("ExileFromGrave");
  });

  it("routes ExileFromTop<3/Card> to Exile", () => {
    const plan = parseCostString("ExileFromTop<3/Card>");
    expect(plan.parts[0]?.handlerKey).toBe("Exile");
  });

  it("routes PayEnergy<2> to PayEnergy", () => {
    const plan = parseCostString("PayEnergy<2>");
    expect(plan.parts[0]?.handlerKey).toBe("PayEnergy");
  });

  it("routes Mill<2> and Mill<2/Card> to Mill", () => {
    expect(parseCostString("Mill<2>").parts[0]?.handlerKey).toBe("Mill");
    expect(parseCostString("Mill<2/Card>").parts[0]?.handlerKey).toBe("Mill");
  });

  it("routes Draw<1/You> to Draw", () => {
    const plan = parseCostString("Draw<1/You>");
    expect(plan.parts[0]?.handlerKey).toBe("Draw");
  });

  it("routes DamageYou<2> to DamageYou", () => {
    const plan = parseCostString("DamageYou<2>");
    expect(plan.parts[0]?.handlerKey).toBe("DamageYou");
  });

  it("routes Reveal<1/Card> to Reveal", () => {
    const plan = parseCostString("Reveal<1/Card>");
    expect(plan.parts[0]?.handlerKey).toBe("Reveal");
  });

  it("routes Return<1/Creature> to Return", () => {
    const plan = parseCostString("Return<1/Creature>");
    expect(plan.parts[0]?.handlerKey).toBe("Return");
  });

  it("routes tapXType<Creature> and tap2Type<Creature> to TapType", () => {
    expect(parseCostString("tapXType<Creature>").parts[0]?.handlerKey).toBe("TapType");
    expect(parseCostString("tap2Type<Creature>").parts[0]?.handlerKey).toBe("TapType");
  });

  it("multi-part: '2 R, T, AddCounter<2/LOYALTY>' parses correctly", () => {
    const plan = parseCostString("2 R, T, AddCounter<2/LOYALTY>");
    expect(plan.parts.map((p) => p.handlerKey)).toEqual(["Mana", "Tap", "PutCounter"]);
  });

  it("Walking Ballista shape: '4, SubCounter<1/P1P1>' parses correctly", () => {
    const plan = parseCostString("4, SubCounter<1/P1P1>");
    expect(plan.parts.map((p) => p.handlerKey)).toEqual(["Mana", "RemoveCounter"]);
  });
});

// ──────────────────────────────────────────────────────────────
// Flagship — Walking Ballista's "Cost$ SubCounter<1/P1P1>" damage ability
// ──────────────────────────────────────────────────────────────

describe("Walking Ballista flagship — SubCounter<1/P1P1> damage ability", () => {
  it("activating the ability removes 1 +1/+1 counter from the source", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    addAllZones(game, seat);
    const ballistaId = mkEntityId(200);
    const ballista = placeCard(game, ballistaId, seat, ZoneType.Battlefield, {
      ...samplePaper,
      name: "Walking Ballista",
    });
    ballista.counters.set(CounterType.PlusOnePlusOne, 1);

    // The cost line: only the SubCounter part — the mana segment is paid
    // separately. We exercise the SubCounter part directly here.
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat,
      sourceCardId: ballistaId,
      raw: "SubCounter<1/P1P1>",
    };
    expect(CostRemoveCounter.canPay(ctx)).toBe(true);
    const receipt = driveNoDecisions(CostRemoveCounter.pay(ctx));
    expect(ballista.counters.has(CounterType.PlusOnePlusOne)).toBe(false);
    // Now with 0 P1P1 counters the cost is no longer payable.
    expect(CostRemoveCounter.canPay(ctx)).toBe(false);
    // Undo restores the counter.
    CostRemoveCounter.undo(receipt, ctx);
    expect(ballista.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { EngineYield } from "./engine-yield.js";
import { GameAction } from "./game-action.js";

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

const samplePaper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  game: Game;
  action: GameAction;
  seat0: PlayerSeat;
  seat1: PlayerSeat;
}

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const addCardToZone = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, samplePaper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const mkFixture = (): Fixture => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(game);
  return {
    game,
    action: new GameAction(game),
    seat0: mkPlayerSeat(0),
    seat1: mkPlayerSeat(1),
  };
};

// Consume a generator to completion, collecting all yielded EngineYields.
const collect = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  for (const y of g) out.push(y);
  return out;
};

describe("GameAction.drawCards", () => {
  it("moves the top card from library to hand and yields CardDrawn", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(10);
    addCardToZone(game, seat0, ZoneType.Library, id);
    const gen = action.drawCards(seat0, 1);
    const next = gen.next();
    expect(next.done).toBe(false);
    const y = next.value;
    if (!y || y.kind !== "event") throw new Error("expected event");
    expect(y.event.kind).toBe("CardDrawn");
    if (y.event.kind !== "CardDrawn") throw new Error("expected CardDrawn");
    expect(y.event.payload.cardId).toBe(id);
    expect(y.event.payload.playerSeat).toBe(seat0);
    expect(gen.next().done).toBe(true);

    const library = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    expect(library?.size).toBe(0);
    expect(hand?.size).toBe(1);
    expect(hand?.contains(id)).toBe(true);
    expect(game.cards.get(id)?.zone).toBe(ZoneType.Hand);
  });

  it("draws multiple cards in top-to-bottom order (Forge convention: index 0 = top)", () => {
    const { game, action, seat0 } = mkFixture();
    // Library items are ordered top-first (Forge/CR convention):
    //   index 0 = TOP of deck (drawn first), items.length-1 = BOTTOM.
    // addCardToZone uses Zone.add which appends at items.length, so the
    // first `top` added winds up at index 0 only if the zone starts empty
    // — but Zone.add appends at the END. Use addToTop to stage a
    // deterministic order: add in reverse so index 0 ends up as `top`.
    const top = mkEntityId(3);
    const middle = mkEntityId(2);
    const bottom = mkEntityId(1);
    // Add them in deck-order (top first) via addToTop on the library zone.
    // Each addToTop places at index 0, so the final list is [top, middle, bottom].
    // We take the library zone and call addToTop directly — addCardToZone
    // would otherwise push at the end and invert the order.
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing library");
    for (const id of [top, middle, bottom]) {
      const card = new Card(id, samplePaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, card);
    }
    // Sequence matters: push bottom, middle, top so final order is
    // [top, middle, bottom] (top ends at index 0).
    lib.addToTop(bottom);
    lib.addToTop(middle);
    lib.addToTop(top);

    const yields = collect(action.drawCards(seat0, 2));
    expect(yields).toHaveLength(2);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[1]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardDrawn") throw new Error("expected CardDrawn");
    if (yields[1].event.kind !== "CardDrawn") throw new Error("expected CardDrawn");
    expect(yields[0].event.payload.cardId).toBe(top);
    expect(yields[1].event.payload.cardId).toBe(middle);
  });

  it("stops drawing when library is empty (no CardDrawn for empty draws)", () => {
    const { action, seat0 } = mkFixture();
    const yields = collect(action.drawCards(seat0, 3));
    expect(yields).toHaveLength(0);
  });
});

describe("GameAction.changeLife", () => {
  it("applies delta and emits LifeChanged with matching oldLife/newLife", () => {
    const { game, action, seat0 } = mkFixture();
    const player = game.getPlayer(seat0);
    expect(player.life).toBe(20);
    const gen = action.changeLife(seat0, -2);
    const next = gen.next();
    expect(next.done).toBe(false);
    const y = next.value;
    if (!y || y.kind !== "event") throw new Error("expected event");
    if (y.event.kind !== "LifeChanged") throw new Error("expected LifeChanged");
    expect(y.event.payload.oldLife).toBe(20);
    expect(y.event.payload.newLife).toBe(18);
    expect(y.event.payload.delta).toBe(-2);
    expect(gen.next().done).toBe(true);
    expect(player.life).toBe(18);
  });

  it("passes through cause option to the event payload", () => {
    const { action, seat0 } = mkFixture();
    const yields = collect(action.changeLife(seat0, 3, { cause: "gainLife" }));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "LifeChanged") throw new Error("expected LifeChanged");
    expect(yields[0].event.payload.cause).toBe("gainLife");
  });
});

describe("GameAction.moveTo", () => {
  it("moves a card from hand to graveyard, emits CardChangedZone, updates Card.zone", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(5);
    addCardToZone(game, seat0, ZoneType.Hand, id);

    const yields = collect(action.moveTo(id, ZoneType.Graveyard));
    expect(yields).toHaveLength(1);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardChangedZone") throw new Error("expected CardChangedZone");
    expect(yields[0].event.payload.cardId).toBe(id);
    expect(yields[0].event.payload.fromZone).toBe(ZoneType.Hand);
    expect(yields[0].event.payload.toZone).toBe(ZoneType.Graveyard);
    expect(yields[0].event.payload.fromSeat).toBe(seat0);
    expect(yields[0].event.payload.toSeat).toBe(seat0);

    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(hand?.contains(id)).toBe(false);
    expect(gy?.contains(id)).toBe(true);
    expect(game.cards.get(id)?.zone).toBe(ZoneType.Graveyard);
  });

  it("moves a card to exile (unowned shared zone)", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(6);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);

    collect(action.moveTo(id, ZoneType.Exile));
    expect(game.sharedZones.exile.contains(id)).toBe(true);
    expect(game.cards.get(id)?.zone).toBe(ZoneType.Exile);
  });

  it("rejects moving to Stack directly", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(7);
    addCardToZone(game, seat0, ZoneType.Hand, id);
    expect(() => collect(action.moveTo(id, ZoneType.Stack))).toThrow(GameStateIntegrityError);
  });

  it("throws when card is not in any tracked zone", () => {
    const { action } = mkFixture();
    expect(() => collect(action.moveTo(mkEntityId(999), ZoneType.Graveyard))).toThrow(
      GameStateIntegrityError,
    );
  });
});

describe("GameAction.tap / untap", () => {
  it("tap sets Card.tapped=true and emits CardTapped", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(20);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const yields = collect(action.tap(id));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    expect(yields[0].event.kind).toBe("CardTapped");
    expect(game.cards.get(id)?.tapped).toBe(true);
  });

  it("untap sets Card.tapped=false and emits CardUntapped", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(21);
    const card = addCardToZone(game, seat0, ZoneType.Battlefield, id);
    card.tapped = true;
    const yields = collect(action.untap(id));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    expect(yields[0].event.kind).toBe("CardUntapped");
    expect(game.cards.get(id)?.tapped).toBe(false);
  });

  it("tap is idempotent: calling twice emits one event, state stays tapped", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(22);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const first = collect(action.tap(id));
    const second = collect(action.tap(id));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(game.cards.get(id)?.tapped).toBe(true);
  });

  it("untap is idempotent: untapping an already-untapped card emits nothing", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(23);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    // Card defaults to tapped=false.
    const yields = collect(action.untap(id));
    expect(yields).toHaveLength(0);
    expect(game.cards.get(id)?.tapped).toBe(false);
  });
});

describe("GameAction.damage", () => {
  it("emits DamageDealt with matching payload", () => {
    const { action } = mkFixture();
    const source = mkEntityId(100);
    const target = mkEntityId(101);
    const yields = collect(action.damage(source, "creature", target, 3, true));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "DamageDealt") throw new Error("expected DamageDealt");
    expect(yields[0].event.payload.sourceId).toBe(source);
    expect(yields[0].event.payload.targetKind).toBe("creature");
    expect(yields[0].event.payload.targetId).toBe(target);
    expect(yields[0].event.payload.amount).toBe(3);
    expect(yields[0].event.payload.isCombat).toBe(true);
  });

  it("applies damage marker when target is a tracked creature", () => {
    const { game, action, seat0 } = mkFixture();
    const source = mkEntityId(200);
    const target = mkEntityId(201);
    addCardToZone(game, seat0, ZoneType.Battlefield, target);
    collect(action.damage(source, "creature", target, 4, false));
    expect(game.cards.get(target)?.damage).toBe(4);
  });
});

describe("GameAction.addCounter / removeCounter", () => {
  it("addCounter increments the Card.counters map by amount", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(300);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    collect(action.addCounter(id, CounterType.PlusOnePlusOne, 2));
    expect(game.cards.get(id)?.counters.get(CounterType.PlusOnePlusOne)).toBe(2);
    const yields = collect(action.addCounter(id, CounterType.PlusOnePlusOne, 1));
    expect(game.cards.get(id)?.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CounterAdded") throw new Error("expected CounterAdded");
    expect(yields[0].event.payload.counterType).toBe(CounterType.PlusOnePlusOne);
    expect(yields[0].event.payload.amount).toBe(1);
  });

  it("removeCounter decrements and deletes entry at zero", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(301);
    const card = addCardToZone(game, seat0, ZoneType.Battlefield, id);
    card.counters.set(CounterType.PlusOnePlusOne, 2);
    collect(action.removeCounter(id, CounterType.PlusOnePlusOne, 1));
    expect(card.counters.get(CounterType.PlusOnePlusOne)).toBe(1);
    collect(action.removeCounter(id, CounterType.PlusOnePlusOne, 5));
    expect(card.counters.has(CounterType.PlusOnePlusOne)).toBe(false);
  });

  it("addCounter rejects zero, negative, NaN, and non-integer amounts", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(310);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    expect(() => collect(action.addCounter(id, CounterType.PlusOnePlusOne, 0))).toThrow(IllegalDecisionError);
    expect(() => collect(action.addCounter(id, CounterType.PlusOnePlusOne, -1))).toThrow(
      IllegalDecisionError,
    );
    expect(() => collect(action.addCounter(id, CounterType.PlusOnePlusOne, Number.NaN))).toThrow(
      IllegalDecisionError,
    );
    expect(() => collect(action.addCounter(id, CounterType.PlusOnePlusOne, 1.5))).toThrow(
      IllegalDecisionError,
    );
  });

  it("removeCounter rejects zero, negative, NaN, and non-integer amounts", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(311);
    const card = addCardToZone(game, seat0, ZoneType.Battlefield, id);
    card.counters.set(CounterType.PlusOnePlusOne, 2);
    expect(() => collect(action.removeCounter(id, CounterType.PlusOnePlusOne, 0))).toThrow(
      IllegalDecisionError,
    );
    expect(() => collect(action.removeCounter(id, CounterType.PlusOnePlusOne, -3))).toThrow(
      IllegalDecisionError,
    );
    expect(() => collect(action.removeCounter(id, CounterType.PlusOnePlusOne, Number.NaN))).toThrow(
      IllegalDecisionError,
    );
    expect(() => collect(action.removeCounter(id, CounterType.PlusOnePlusOne, 2.5))).toThrow(
      IllegalDecisionError,
    );
  });

  it("removeCounter is a no-op (emits no event) when the counter type is not present", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(312);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    // No counters on the card at all.
    const yields = collect(action.removeCounter(id, CounterType.PlusOnePlusOne, 1));
    expect(yields).toHaveLength(0);
    // Also no-op when a different counter type exists but not the targeted one.
    game.cards.get(id)?.counters.set(CounterType.Loyalty, 3);
    const yields2 = collect(action.removeCounter(id, CounterType.PlusOnePlusOne, 1));
    expect(yields2).toHaveLength(0);
    // Sanity: the Loyalty counters weren't touched.
    expect(game.cards.get(id)?.counters.get(CounterType.Loyalty)).toBe(3);
  });
});

describe("GameAction.changeControl", () => {
  it("updates Card.controllerSeat and emits ControlChanged", () => {
    const { game, action, seat0, seat1 } = mkFixture();
    const id = mkEntityId(400);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const yields = collect(action.changeControl(id, seat1));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "ControlChanged") throw new Error("expected ControlChanged");
    expect(yields[0].event.payload.oldController).toBe(seat0);
    expect(yields[0].event.payload.newController).toBe(seat1);
    expect(game.cards.get(id)?.controllerSeat).toBe(seat1);
  });
});

describe("GameAction.putOnStack", () => {
  const mkSpellItem = (): StackItem => ({
    id: mkEntityId(500),
    sourceCardId: mkEntityId(501),
    controllerSeat: mkPlayerSeat(0),
    kind: "spell",
    isCast: true,
    targets: null,
    modes: [],
    xValue: null,
    costPaid: null,
    provenance: { originZone: ZoneType.Hand, altCostUsed: null, additionalCostsPaid: [] },
  });

  const mkActivatedItem = (): StackItem => ({
    id: mkEntityId(600),
    sourceCardId: mkEntityId(601),
    controllerSeat: mkPlayerSeat(0),
    kind: "activatedAbility",
    isCast: false,
    targets: null,
    modes: [],
    xValue: null,
    costPaid: null,
    provenance: { originZone: ZoneType.Battlefield, altCostUsed: null, additionalCostsPaid: [] },
  });

  it("pushes a spell item and emits SpellPutOnStack", () => {
    const { game, action } = mkFixture();
    const yields = collect(action.putOnStack(mkSpellItem()));
    expect(game.sharedZones.stack.size).toBe(1);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    expect(yields[0].event.kind).toBe("SpellPutOnStack");
  });

  it("pushes an activated ability and emits AbilityActivated", () => {
    const { game, action } = mkFixture();
    const yields = collect(action.putOnStack(mkActivatedItem()));
    expect(game.sharedZones.stack.size).toBe(1);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    expect(yields[0].event.kind).toBe("AbilityActivated");
  });
});

describe("GameAction.destroy / exile / sacrifice", () => {
  it("destroy emits CardDestroyed then CardChangedZone to graveyard", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(700);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const yields = collect(action.destroy(id));
    expect(yields).toHaveLength(2);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[1]?.kind !== "event") throw new Error("expected event");
    expect(yields[0].event.kind).toBe("CardDestroyed");
    expect(yields[1].event.kind).toBe("CardChangedZone");
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(id)).toBe(true);
  });

  it("exile emits CardExiled then CardChangedZone to exile", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(800);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const yields = collect(action.exile(id));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    expect(yields[0].event.kind).toBe("CardExiled");
    expect(game.sharedZones.exile.contains(id)).toBe(true);
  });

  it("sacrifice emits CardSacrificed with correct playerSeat then moves to graveyard", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(900);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const yields = collect(action.sacrifice(id));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardSacrificed") throw new Error("expected CardSacrificed");
    expect(yields[0].event.payload.playerSeat).toBe(seat0);
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(id)).toBe(true);
  });
});

describe("GameAction.mill / shuffle", () => {
  it("mill moves top-of-library to graveyard and emits CardMilled", () => {
    const { game, action, seat0 } = mkFixture();
    // Forge convention: index 0 = top. Place `b` on top via addToTop so the
    // first mill consumes `b` regardless of add ordering.
    const a = mkEntityId(1000);
    const b = mkEntityId(1001);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing library");
    game.cards.set(a, new Card(a, samplePaper, seat0, seat0, ZoneType.Library));
    game.cards.set(b, new Card(b, samplePaper, seat0, seat0, ZoneType.Library));
    lib.add(a); // bottom
    lib.addToTop(b); // b is now at index 0 (top)
    const yields = collect(action.mill(seat0, 1));
    expect(yields).toHaveLength(1);
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardMilled") throw new Error("expected CardMilled");
    expect(yields[0].event.payload.cardId).toBe(b);
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(b)).toBe(true);
    expect(gy?.contains(a)).toBe(false);
  });

  it("shuffle reorders library contents deterministically via rng", () => {
    const { game, action, seat0 } = mkFixture();
    for (let i = 0; i < 5; i++) addCardToZone(game, seat0, ZoneType.Library, mkEntityId(2000 + i));
    const before = game.getPlayer(seat0).zones.get(ZoneType.Library)?.toArray();
    collect(action.shuffle(seat0));
    const after = game.getPlayer(seat0).zones.get(ZoneType.Library)?.toArray();
    expect(after).toBeDefined();
    expect(after?.length).toBe(5);
    // Same multiset, different order is expected in the overwhelming majority of
    // cases with a seeded rng; assert set equality for the ids.
    expect(new Set(after)).toEqual(new Set(before));
  });
});

describe("GameAction locate / zoneFor", () => {
  it("locate finds a card in a per-player zone and reports its owner", () => {
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(5000);
    addCardToZone(game, seat0, ZoneType.Hand, id);
    // Indirectly validate via moveTo's CardChangedZone event shape.
    const yields = collect(action.moveTo(id, ZoneType.Graveyard));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardChangedZone") throw new Error("expected CardChangedZone");
    expect(yields[0].event.payload.fromZone).toBe(ZoneType.Hand);
    expect(yields[0].event.payload.fromSeat).toBe(seat0);
  });

  it("locate finds a card in the shared Exile zone with no owner", () => {
    const { game, action } = mkFixture();
    const id = mkEntityId(6000);
    const card = new Card(id, samplePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Exile);
    game.cards.set(id, card);
    game.sharedZones.exile.add(id);
    const yields = collect(action.moveTo(id, ZoneType.Ante));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardChangedZone") throw new Error("expected CardChangedZone");
    expect(yields[0].event.payload.fromZone).toBe(ZoneType.Exile);
    expect(yields[0].event.payload.fromSeat).toBeUndefined();
  });
});

describe("GameAction throw-path coverage (Reviewer C §2)", () => {
  // WHY: each throw site in game-action.ts is a contract boundary — callers
  // rely on these rejections to surface state-integrity bugs. Lock the
  // specific error class so controller code can pattern-match reliably.

  it("sacrifice rejects a card not owned by any player (not in any zone)", () => {
    const { action } = mkFixture();
    // Card is not registered in any zone → locate() throws, which surfaces
    // before sacrifice's owner-null branch would otherwise fire.
    expect(() => collect(action.sacrifice(mkEntityId(9001)))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.sacrifice(mkEntityId(9001)))).toThrow(/not found in any zone/);
  });

  it("moveTo rejects a card tracked in game.cards but not in any zone array", () => {
    // WHY: consistency check. A card registered in game.cards but absent from
    // every Zone.items is a state-integrity bug (mid-move state leak, tests
    // that set up cards without staging them, etc.). locate() must throw.
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(9002);
    game.cards.set(id, new Card(id, samplePaper, seat0, seat0, ZoneType.Battlefield));
    // Deliberately do NOT add to any zone.
    expect(() => collect(action.moveTo(id, ZoneType.Graveyard))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.moveTo(id, ZoneType.Graveyard))).toThrow(/not found in any zone/);
  });

  it("moveTo to shared zone without owner is allowed (toSeat defaults to null via defaultDestinationSeat)", () => {
    // WHY: positive counterpart — shared destinations (Exile/Ante) don't
    // require an owner; the default path wires toSeat=null and zoneFor
    // returns the shared zone. This locks the branch that flanks the
    // rejection path below.
    const { game, action, seat0 } = mkFixture();
    const id = mkEntityId(9003);
    addCardToZone(game, seat0, ZoneType.Battlefield, id);
    const yields = collect(action.moveTo(id, ZoneType.Exile));
    if (yields[0]?.kind !== "event") throw new Error("expected event");
    if (yields[0].event.kind !== "CardChangedZone") throw new Error("expected CardChangedZone");
    expect(yields[0].event.payload.toSeat).toBeUndefined();
  });

  it("moveTo from a shared zone to a per-player zone routes to the card's ownerSeat (CR 400.7)", () => {
    // SP2 Task 44 — defaultDestinationSeat consults the card record for
    // the owner even when the source zone is shared (fromOwner=null).
    // Prior to Task 44 this path threw "Zone X requires an owner"; with
    // the CR 400.7 fix the card record's ownerSeat authoritatively wins.
    const { game, action } = mkFixture();
    const id = mkEntityId(9004);
    const owner = mkPlayerSeat(0);
    const card = new Card(id, samplePaper, owner, owner, ZoneType.Exile);
    game.cards.set(id, card);
    game.sharedZones.exile.add(id);
    collect(action.moveTo(id, ZoneType.Graveyard));
    expect(game.getPlayer(owner).zones.get(ZoneType.Graveyard)?.contains(id)).toBe(true);
    expect(game.sharedZones.exile.contains(id)).toBe(false);
  });

  it("changeControl throws when the card is not tracked in game.cards", () => {
    // WHY: changeControl reads card.controllerSeat *before* applying the new
    // value so the event can report oldController. An untracked card makes
    // that read undefined — throw rather than emit a half-valid event.
    const { action } = mkFixture();
    expect(() => collect(action.changeControl(mkEntityId(9005), mkPlayerSeat(1)))).toThrow(
      GameStateIntegrityError,
    );
    expect(() => collect(action.changeControl(mkEntityId(9005), mkPlayerSeat(1)))).toThrow(/not tracked/);
  });

  it("drawCards throws when the target player has no Library zone", () => {
    const { game, action, seat0 } = mkFixture();
    // Drop the library. Hand remains so the throw reflects the library path.
    game.getPlayer(seat0).zones.delete(ZoneType.Library);
    expect(() => collect(action.drawCards(seat0, 1))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.drawCards(seat0, 1))).toThrow(/has no Library zone/);
  });

  it("drawCards throws when the target player has no Hand zone", () => {
    // WHY: drawCards checks for Hand BEFORE touching the library (lines 39-40).
    // So even an empty library trips the Hand check here — no need to seed
    // cards, and the second expect-invocation also throws deterministically.
    const { game, action, seat0 } = mkFixture();
    game.getPlayer(seat0).zones.delete(ZoneType.Hand);
    expect(() => collect(action.drawCards(seat0, 1))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.drawCards(seat0, 1))).toThrow(/has no Hand zone/);
  });

  it("mill throws when the target player has no Library zone", () => {
    const { game, action, seat0 } = mkFixture();
    game.getPlayer(seat0).zones.delete(ZoneType.Library);
    expect(() => collect(action.mill(seat0, 1))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.mill(seat0, 1))).toThrow(/has no Library zone/);
  });

  it("mill throws when the target player has no Graveyard zone and library has cards", () => {
    // WHY: seed two cards so both `expect(...).toThrow(...)` invocations
    // reach the graveyard-missing check (each call consumes one card).
    const { game, action, seat0 } = mkFixture();
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(9200));
    addCardToZone(game, seat0, ZoneType.Library, mkEntityId(9201));
    game.getPlayer(seat0).zones.delete(ZoneType.Graveyard);
    expect(() => collect(action.mill(seat0, 1))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.mill(seat0, 1))).toThrow(/has no Graveyard zone/);
  });

  it("shuffle throws when the target player has no Library zone", () => {
    const { game, action, seat0 } = mkFixture();
    game.getPlayer(seat0).zones.delete(ZoneType.Library);
    expect(() => collect(action.shuffle(seat0))).toThrow(GameStateIntegrityError);
    expect(() => collect(action.shuffle(seat0))).toThrow(/has no Library zone/);
  });
});

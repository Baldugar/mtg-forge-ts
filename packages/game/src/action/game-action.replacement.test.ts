// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 19 — integration tests verifying that every GameAction mutation
// routes through the replacement chain. Each test registers a replacement
// (or none) and checks:
//   - the sequence of EngineYield events GameAction emits,
//   - the final game state,
//   - that ReplacementApplied / EventPrevented fire with the right payload.
import type {
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
} from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
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

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

interface Fixture {
  game: Game;
  action: GameAction;
  seat0: PlayerSeat;
  seat1: PlayerSeat;
}

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
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

// Drive a GameAction generator that may yield an orderReplacements decision
// mid-flight. Auto-accept the suggested order; collect every yield.
const runAll = (gen: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    out.push(y);
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...y.request.replacementIds] });
    } else {
      step = gen.next();
    }
  }
  return out;
};

type Apply = (i: MutationIntent) => MutationIntent | null;
type Matches = (i: MutationIntent) => boolean;

const mkReplacement = (
  id: number,
  sourceCardId: number,
  apply: Apply,
  matches: Matches = () => true,
): ReplacementAbility => ({
  id: mkEntityId(id),
  kind: "replacement",
  sourceCardId: mkEntityId(sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches,
  apply: (i) => apply(i),
  isSelfReplacement: false,
});

// Filter helper.
const eventsOfKind = (ys: EngineYield[], kind: string): EngineYield[] =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind);

describe("GameAction.damage — replacement routing (SP2 Task 19)", () => {
  it("no replacement registered → exactly one DamageDealt, no ReplacementApplied/Prevented", () => {
    const { action, game } = mkFixture();
    const source = mkEntityId(100);
    const target = mkEntityId(101);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, target);
    const ys = runAll(action.damage(source, "creature", target, 3, false));
    expect(ys).toHaveLength(1);
    if (ys[0]?.kind !== "event") throw new Error("event expected");
    expect(ys[0].event.kind).toBe("DamageDealt");
    expect(game.cards.get(target)?.damage).toBe(3);
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(0);
    expect(eventsOfKind(ys, "EventPrevented")).toHaveLength(0);
  });

  it("one replacement redirects damage to a different target", () => {
    const { action, game } = mkFixture();
    const source = mkEntityId(200);
    const original = mkEntityId(201);
    const substituted = mkEntityId(202);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, original);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, substituted);
    game.replacementRegistry.register(
      mkReplacement(1, 999, (i) => {
        // Swap targetId to substituted.
        return {
          ...(i as unknown as Record<string, unknown>),
          targetId: substituted,
        } as unknown as MutationIntent;
      }),
    );
    const ys = runAll(action.damage(source, "creature", original, 4, false));
    // Expect: ReplacementApplied, DamageDealt (final targetId).
    const replApplied = eventsOfKind(ys, "ReplacementApplied");
    const damageDealt = eventsOfKind(ys, "DamageDealt");
    expect(replApplied).toHaveLength(1);
    expect(damageDealt).toHaveLength(1);
    if (damageDealt[0]?.kind !== "event") throw new Error("event");
    if (damageDealt[0].event.kind !== "DamageDealt") throw new Error("DamageDealt");
    expect(damageDealt[0].event.payload.targetId).toBe(substituted);
    // Damage markers land on the substituted card, not the original.
    expect(game.cards.get(substituted)?.damage).toBe(4);
    expect(game.cards.get(original)?.damage).toBe(0);
  });

  it("one replacement prevents damage → EventPrevented, no DamageDealt, no marker", () => {
    const { action, game } = mkFixture();
    const source = mkEntityId(300);
    const target = mkEntityId(301);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, target);
    game.replacementRegistry.register(mkReplacement(1, 999, () => null));
    const ys = runAll(action.damage(source, "creature", target, 5, false));
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(1);
    expect(eventsOfKind(ys, "EventPrevented")).toHaveLength(1);
    expect(eventsOfKind(ys, "DamageDealt")).toHaveLength(0);
    expect(game.cards.get(target)?.damage).toBe(0);
  });

  it("two replacements each add +1 damage; both apply, final amount = original + 2", () => {
    const { action, game } = mkFixture();
    const source = mkEntityId(400);
    const target = mkEntityId(401);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, target);
    const bump = (i: MutationIntent): MutationIntent =>
      ({
        ...(i as unknown as Record<string, unknown>),
        amount: ((i as unknown as { amount: number }).amount ?? 0) + 1,
      }) as unknown as MutationIntent;
    game.replacementRegistry.register(mkReplacement(1, 900, bump));
    game.replacementRegistry.register(mkReplacement(2, 901, bump));
    const ys = runAll(action.damage(source, "creature", target, 3, false));
    const damageDealt = eventsOfKind(ys, "DamageDealt");
    expect(damageDealt).toHaveLength(1);
    if (damageDealt[0]?.kind !== "event") throw new Error("event");
    if (damageDealt[0].event.kind !== "DamageDealt") throw new Error("DamageDealt");
    expect(damageDealt[0].event.payload.amount).toBe(5);
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(2);
    expect(game.cards.get(target)?.damage).toBe(5);
  });
});

describe("GameAction.moveTo — replacement routing", () => {
  it("ETB self-replacement on moveTo(Battlefield) applies before external", () => {
    // Register one self and one external replacement; both are identity
    // apply-fns that append to an order log. Assert self fires first.
    const { action, game, seat0 } = mkFixture();
    const id = mkEntityId(500);
    addCard(game, seat0, ZoneType.Hand, id);
    const order: string[] = [];
    game.replacementRegistry.register(
      mkReplacement(
        1,
        999, // external sourceCardId
        (i) => {
          order.push("external");
          return i;
        },
      ),
    );
    game.replacementRegistry.register(
      mkReplacement(
        2,
        // self sourceCardId === intent.cardId
        Number(id),
        (i) => {
          order.push("self");
          return i;
        },
      ),
    );
    runAll(action.moveTo(id, ZoneType.Battlefield));
    expect(order).toEqual(["self", "external"]);
    expect(game.cards.get(id)?.zone).toBe(ZoneType.Battlefield);
  });

  it("a replacement on moveTo→Graveyard rewrites to Exile; card ends up in Exile", () => {
    const { action, game, seat0 } = mkFixture();
    const id = mkEntityId(600);
    addCard(game, seat0, ZoneType.Battlefield, id);
    game.replacementRegistry.register(
      mkReplacement(
        1,
        999,
        (i) => {
          const src = i as unknown as { toZone: ZoneType; toSeat: PlayerSeat | null };
          if (src.toZone !== ZoneType.Graveyard) return i;
          return {
            ...(i as unknown as Record<string, unknown>),
            toZone: ZoneType.Exile,
            toSeat: null,
          } as unknown as MutationIntent;
        },
        (i) => (i as unknown as { kind: string }).kind === "moveTo",
      ),
    );
    runAll(action.moveTo(id, ZoneType.Graveyard));
    expect(game.sharedZones.exile.contains(id)).toBe(true);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.contains(id)).toBe(false);
    expect(game.cards.get(id)?.zone).toBe(ZoneType.Exile);
  });
});

describe("GameAction.changeLife — replacement routing", () => {
  it("prevention on life loss: player.life unchanged, EventPrevented emitted", () => {
    const { action, game, seat0 } = mkFixture();
    const player = game.getPlayer(seat0);
    const before = player.life;
    game.replacementRegistry.register(
      mkReplacement(
        1,
        999,
        () => null,
        (i) => (i as unknown as { delta: number }).delta < 0,
      ),
    );
    const ys = runAll(action.changeLife(seat0, -5));
    expect(player.life).toBe(before);
    expect(eventsOfKind(ys, "EventPrevented")).toHaveLength(1);
    expect(eventsOfKind(ys, "LifeChanged")).toHaveLength(0);
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(1);
  });
});

describe("GameAction.addCounter — replacement routing", () => {
  it("replacement doubles the counter amount; card.counters reflects the doubled count", () => {
    const { action, game, seat0 } = mkFixture();
    const id = mkEntityId(700);
    addCard(game, seat0, ZoneType.Battlefield, id);
    game.replacementRegistry.register(
      mkReplacement(
        1,
        999,
        (i) => {
          const src = i as unknown as { amount: number };
          return {
            ...(i as unknown as Record<string, unknown>),
            amount: src.amount * 2,
          } as unknown as MutationIntent;
        },
        (i) => (i as unknown as { kind: string }).kind === "addCounter",
      ),
    );
    const ys = runAll(action.addCounter(id, CounterType.PlusOnePlusOne, 3));
    expect(game.cards.get(id)?.counters.get(CounterType.PlusOnePlusOne)).toBe(6);
    const counterAdded = eventsOfKind(ys, "CounterAdded");
    if (counterAdded[0]?.kind !== "event") throw new Error("event");
    if (counterAdded[0].event.kind !== "CounterAdded") throw new Error("CounterAdded");
    expect(counterAdded[0].event.payload.amount).toBe(6);
  });
});

describe("GameAction — one-apply rule (CR 614.5) via GameAction", () => {
  it("identity replacement fires exactly once even though matches() stays true", () => {
    const { action, game } = mkFixture();
    const source = mkEntityId(800);
    const target = mkEntityId(801);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, target);
    let calls = 0;
    game.replacementRegistry.register(
      mkReplacement(1, 999, (i) => {
        calls++;
        return i;
      }),
    );
    const ys = runAll(action.damage(source, "creature", target, 2, false));
    expect(calls).toBe(1);
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(1);
    expect(eventsOfKind(ys, "DamageDealt")).toHaveLength(1);
    expect(game.cards.get(target)?.damage).toBe(2);
  });
});

describe("GameAction — ReplacementApplied payload shape", () => {
  it("ReplacementApplied carries replacementId, original, and replaced intents", () => {
    const { action, game, seat0 } = mkFixture();
    const id = mkEntityId(900);
    addCard(game, seat0, ZoneType.Battlefield, id);
    game.replacementRegistry.register(
      mkReplacement(
        1,
        999,
        (i) =>
          ({
            ...(i as unknown as Record<string, unknown>),
            amount: 10,
          }) as unknown as MutationIntent,
      ),
    );
    const ys = runAll(action.addCounter(id, CounterType.PlusOnePlusOne, 1));
    const applied = eventsOfKind(ys, "ReplacementApplied");
    expect(applied).toHaveLength(1);
    if (applied[0]?.kind !== "event") throw new Error("event");
    if (applied[0].event.kind !== "ReplacementApplied") throw new Error("ReplacementApplied");
    expect(applied[0].event.payload.replacementId).toBe(mkEntityId(1));
    // `original` is the pre-chain intent; `replaced` is the post-chain final.
    const original = applied[0].event.payload.original as { amount: number };
    const replaced = applied[0].event.payload.replaced as { amount: number };
    expect(original.amount).toBe(1);
    expect(replaced.amount).toBe(10);
  });

  it("on prevention, EventPrevented.payload.original is the pre-chain intent", () => {
    const { action, game, seat0 } = mkFixture();
    const id = mkEntityId(1000);
    addCard(game, seat0, ZoneType.Battlefield, id);
    game.replacementRegistry.register(mkReplacement(1, 999, () => null));
    const ys = runAll(action.tap(id));
    const prevented = eventsOfKind(ys, "EventPrevented");
    expect(prevented).toHaveLength(1);
    if (prevented[0]?.kind !== "event") throw new Error("event");
    if (prevented[0].event.kind !== "EventPrevented") throw new Error("EventPrevented");
    const orig = prevented[0].event.payload.original as { kind: string; cardId: EntityId };
    expect(orig.kind).toBe("tap");
    expect(orig.cardId).toBe(id);
    // State unchanged.
    expect(game.cards.get(id)?.tapped).toBe(false);
  });
});

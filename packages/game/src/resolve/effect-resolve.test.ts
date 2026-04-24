// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 67 — resolveStackItem tests. Covers:
//   - resolver with no yield (pure state mutation)
//   - resolver that yields a decision (generator propagation)
//   - spell zone-change destination (default Graveyard + alt)
//   - copy items skip zone-change
//   - activated abilities leave the source card alone
//   - triggered items with intervening-if failing at resolve fizzle
//   - triggered items with intervening-if passing run the resolver
import type {
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem, StackItemResolver } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { resolveStackItem } from "./effect-resolve.js";

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

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

const mkGame = (): Game => {
  const lobby: LobbyPlayer[] = [
    { id: "a", name: "A", controllerKind: "human" },
    { id: "b", name: "B", controllerKind: "ai" },
  ];
  const game = new Game({ lobbyPlayers: lobby, rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  if (zone === ZoneType.Exile) {
    game.sharedZones.exile.add(id);
  } else if (zone === ZoneType.Stack) {
    // Stack is a rich StackItem record, not a Zone; tests that pass a
    // Stack card record just track the Card entry without zone
    // membership — callers are responsible for moving the card into a
    // real zone before a moveTo sees it.
  } else {
    const z = game.getPlayer(seat).zones.get(zone);
    if (!z) throw new Error("no zone");
    z.add(id);
  }
  return card;
};

const mkStackItem = (overrides: Partial<StackItem> & Pick<StackItem, "kind" | "id">): StackItem => ({
  sourceCardId: overrides.sourceCardId ?? mkEntityId(1),
  controllerSeat: overrides.controllerSeat ?? mkPlayerSeat(0),
  isCast: overrides.isCast ?? false,
  targets: null,
  modes: [],
  xValue: null,
  costPaid: null,
  provenance: overrides.provenance ?? {
    originZone: ZoneType.Hand,
    altCostUsed: null,
    additionalCostsPaid: [],
  },
  ...overrides,
});

const drive = (
  gen: Generator<EngineYield, void, unknown>,
  responder?: (y: Extract<EngineYield, { kind: "decision" }>) => unknown,
): EngineYield[] => {
  const seen: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    seen.push(step.value);
    if (step.value.kind === "decision" && responder) {
      step = gen.next(responder(step.value));
    } else {
      step = gen.next();
    }
  }
  return seen;
};

describe("resolveStackItem (SP2 Task 67)", () => {
  it("resolver with no yield emits StackItemResolved cleanly", () => {
    const game = mkGame();
    const source = mkEntityId(10);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, source);
    let resolverRan = false;
    const resolver: StackItemResolver = {
      // biome-ignore lint/correctness/useYield: intentional no-yield resolver
      *resolve(_game) {
        resolverRan = true;
      },
    };
    const item = mkStackItem({
      id: mkEntityId(500),
      kind: "activatedAbility",
      sourceCardId: source,
      resolver,
    });
    const yields = drive(resolveStackItem(game, item));
    expect(resolverRan).toBe(true);
    const resolved = yields.find((y) => y.kind === "event" && y.event.kind === "StackItemResolved");
    if (!resolved || resolved.kind !== "event" || resolved.event.kind !== "StackItemResolved") {
      throw new Error("expected StackItemResolved");
    }
    expect(resolved.event.payload.stackItemId).toBe(item.id);
    expect(resolved.event.payload.fizzled).toBe(false);
  });

  it("resolver yielding a decision propagates + resumes from response", () => {
    const game = mkGame();
    const source = mkEntityId(10);
    addCard(game, mkPlayerSeat(0), ZoneType.Battlefield, source);
    let capturedX = 0;
    const resolver: StackItemResolver = {
      *resolve(_game) {
        const resp = (yield {
          kind: "decision",
          request: {
            kind: "chooseNumber",
            sourceId: mkEntityId(1),
            min: 0,
            max: 10,
          },
        }) as { readonly kind: "chooseNumber"; readonly chosen: number };
        capturedX = resp.chosen;
      },
    };
    const item = mkStackItem({
      id: mkEntityId(501),
      kind: "activatedAbility",
      sourceCardId: source,
      resolver,
    });
    drive(resolveStackItem(game, item), (y) => {
      expect(y.request.kind).toBe("chooseNumber");
      return { kind: "chooseNumber", chosen: 7 };
    });
    expect(capturedX).toBe(7);
  });

  it("spell with no alternativeZoneDestination goes to Graveyard", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(20);
    addCard(game, seat, ZoneType.Stack, source);
    // The card must exist somewhere for moveTo's locate() to work — we'll
    // say it's on the stack zone (stack sets card.zone when pushed). In
    // actual SP2 flow, the CastPipeline moves the source to the stack and
    // sets card.zone = Stack. For this unit test, the Card record is on
    // Stack (no zone membership per Stack's non-Zone nature), so locate
    // will throw. Instead we pre-seat the card on Hand to simulate the
    // "about to leave hand" state.
    const card = game.cards.get(source);
    if (!card) throw new Error("missing card");
    card.zone = ZoneType.Hand;
    game.getPlayer(seat).zones.get(ZoneType.Hand)?.add(source);
    const item = mkStackItem({
      id: mkEntityId(502),
      kind: "spell",
      sourceCardId: source,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
    });
    drive(resolveStackItem(game, item));
    expect(card.zone).toBe(ZoneType.Graveyard);
  });

  it("spell with alternativeZoneDestination Exile routes to Exile", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(21);
    addCard(game, seat, ZoneType.Hand, source);
    const item = mkStackItem({
      id: mkEntityId(503),
      kind: "spell",
      sourceCardId: source,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: "flashback",
        additionalCostsPaid: [],
        alternativeZoneDestination: ZoneType.Exile,
      },
    });
    drive(resolveStackItem(game, item));
    const card = game.cards.get(source);
    expect(card?.zone).toBe(ZoneType.Exile);
  });

  it("copy stack item does NOT zone-change the source card", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(22);
    const card = addCard(game, seat, ZoneType.Battlefield, source);
    const before = card.zone;
    const item = mkStackItem({
      id: mkEntityId(504),
      kind: "copy",
      sourceCardId: source,
    });
    drive(resolveStackItem(game, item));
    expect(card.zone).toBe(before);
  });

  it("activated ability stack item leaves source card in place", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(23);
    const card = addCard(game, seat, ZoneType.Battlefield, source);
    const item = mkStackItem({
      id: mkEntityId(505),
      kind: "activatedAbility",
      sourceCardId: source,
    });
    drive(resolveStackItem(game, item));
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  it("triggered item with interveningIf failing at resolve fizzles", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(30);
    addCard(game, seat, ZoneType.Battlefield, source);
    const trigger: TriggeredAbility = {
      id: mkEntityId(200),
      kind: "triggered",
      sourceCardId: source,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: seat,
      matches: () => true,
      interveningIf: () => false,
      isDelayed: false,
    };
    game.triggerRegistry.register(trigger);
    const firingEvent: GameEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    let resolverRan = false;
    const resolver: StackItemResolver = {
      // biome-ignore lint/correctness/useYield: no yield needed
      *resolve(_g) {
        resolverRan = true;
      },
    };
    const item = mkStackItem({
      id: mkEntityId(600),
      kind: "triggeredAbility",
      sourceCardId: source,
      triggerId: trigger.id,
      event: firingEvent,
      resolver,
    });
    const yields = drive(resolveStackItem(game, item));
    expect(resolverRan).toBe(false);
    const resolved = yields.find((y) => y.kind === "event" && y.event.kind === "StackItemResolved");
    if (!resolved || resolved.kind !== "event" || resolved.event.kind !== "StackItemResolved") {
      throw new Error("missing event");
    }
    expect(resolved.event.payload.fizzled).toBe(true);
  });

  it("triggered item with interveningIf passing at resolve runs the resolver", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(31);
    addCard(game, seat, ZoneType.Battlefield, source);
    const trigger: TriggeredAbility = {
      id: mkEntityId(201),
      kind: "triggered",
      sourceCardId: source,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: seat,
      matches: () => true,
      interveningIf: () => true,
      isDelayed: false,
    };
    game.triggerRegistry.register(trigger);
    const firingEvent: GameEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    let resolverRan = false;
    const resolver: StackItemResolver = {
      // biome-ignore lint/correctness/useYield: no yield needed
      *resolve(_g) {
        resolverRan = true;
      },
    };
    const item = mkStackItem({
      id: mkEntityId(601),
      kind: "triggeredAbility",
      sourceCardId: source,
      triggerId: trigger.id,
      event: firingEvent,
      resolver,
    });
    const yields = drive(resolveStackItem(game, item));
    expect(resolverRan).toBe(true);
    const resolved = yields.find((y) => y.kind === "event" && y.event.kind === "StackItemResolved");
    if (!resolved || resolved.kind !== "event" || resolved.event.kind !== "StackItemResolved") {
      throw new Error("missing event");
    }
    expect(resolved.event.payload.fizzled).toBe(false);
  });

  it("triggered item WITHOUT an event payload still runs the resolver (can't re-check)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(32);
    addCard(game, seat, ZoneType.Battlefield, source);
    let resolverRan = false;
    const resolver: StackItemResolver = {
      // biome-ignore lint/correctness/useYield: no yield needed
      *resolve(_g) {
        resolverRan = true;
      },
    };
    const item = mkStackItem({
      id: mkEntityId(602),
      kind: "triggeredAbility",
      sourceCardId: source,
      resolver,
    });
    drive(resolveStackItem(game, item));
    expect(resolverRan).toBe(true);
  });

  it("item with no resolver at all still emits StackItemResolved and handles zone change", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mkEntityId(40);
    addCard(game, seat, ZoneType.Hand, source);
    const item = mkStackItem({
      id: mkEntityId(700),
      kind: "spell",
      sourceCardId: source,
    });
    const yields = drive(resolveStackItem(game, item));
    expect(yields.some((y) => y.kind === "event" && y.event.kind === "StackItemResolved")).toBe(true);
    expect(game.cards.get(source)?.zone).toBe(ZoneType.Graveyard);
  });
});

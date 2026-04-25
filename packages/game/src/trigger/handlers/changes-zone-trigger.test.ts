// SPDX-License-Identifier: GPL-3.0-or-later
// Task 2 — ChangesZoneTrigger tests.
// Part E2 additions: resolver stamping + drive tests.
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, TriggerAst } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Import for side-effect to register ChangesZoneTrigger at module load time.
import { ChangesZoneTrigger } from "./changes-zone-trigger.js";

// Self-register effects into effectRegistry so DrawEffect is available.
import "../../ability/effects/index.js";
// Register cost parts so SpellAbility cost parsing doesn't fail.
import "../../cost/parts/index.js";

const SOURCE_ID = mkEntityId(10);
const OTHER_ID = mkEntityId(99);
const TRIGGER_ID = mkEntityId(1);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkEtbAst = (): TriggerAst => ({
  mode: "ChangesZone",
  params: {
    Origin: { kind: "literal", raw: "Any" },
    Destination: { kind: "literal", raw: "Battlefield" },
    ValidCard: { kind: "literal", raw: "Card.Self" },
  },
  effect: { handlerKey: "TrigDraw", params: {} },
});

const mkCardChangedZoneEvent = (
  cardId: ReturnType<typeof mkEntityId>,
  fromZone: ZoneType,
  toZone: ZoneType,
) =>
  mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
    cardId,
    fromZone,
    toZone,
  });

// Re-register after each clear since afterEach clears the registry
afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(ChangesZoneTrigger);
});

// Ensure the handler is registered before all tests in this file
triggerHandlerRegistry.register(ChangesZoneTrigger);

describe("ChangesZoneTrigger", () => {
  it("is registered under mode 'ChangesZone'", () => {
    expect(triggerHandlerRegistry.has("ChangesZone")).toBe(true);
  });

  describe("ETB self-trigger (ValidCard$ Card.Self)", () => {
    it("matches when the source card enters battlefield from any zone", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when a different card enters battlefield", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const event = mkCardChangedZoneEvent(OTHER_ID, ZoneType.Hand, ZoneType.Battlefield);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match when the source card enters graveyard (wrong destination)", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match a non-CardChangedZone event", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      const lifeEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
        playerSeat: CONTROLLER,
        oldLife: 20,
        newLife: 18,
        delta: -2,
        cause: "effect",
      });
      expect(ta.matches(lifeEvent)).toBe(false);
    });
  });

  describe("LTB self-trigger (Origin$ Battlefield, Destination$ Any)", () => {
    it("matches when source card leaves battlefield", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ltbAst: TriggerAst = {
        mode: "ChangesZone",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Any" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        effect: { handlerKey: "TrigLTB", params: {} },
      };
      const ta = new Cls().build(ltbAst, mkCtx());

      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when card enters (wrong origin)", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ltbAst: TriggerAst = {
        mode: "ChangesZone",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Any" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        effect: { handlerKey: "TrigLTB", params: {} },
      };
      const ta = new Cls().build(ltbAst, mkCtx());

      // Card moving Hand → Battlefield — wrong origin
      const event = mkCardChangedZoneEvent(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield);
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("global watcher (ValidCard$ Card)", () => {
    it("matches any card moving to graveyard", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const watcherAst: TriggerAst = {
        mode: "ChangesZone",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Graveyard" },
          ValidCard: { kind: "literal", raw: "Card" },
        },
        effect: { handlerKey: "TrigWatch", params: {} },
      };
      const ta = new Cls().build(watcherAst, mkCtx());

      const event = mkCardChangedZoneEvent(OTHER_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ta.matches(event)).toBe(true);
    });
  });

  describe("TriggeredAbility identity fields", () => {
    it("has correct id, sourceCardId, controllerSeatAtReg, kind", () => {
      const Cls = triggerHandlerRegistry.lookup("ChangesZone");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkEtbAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Part E2 — resolver stamping tests
// ---------------------------------------------------------------------------

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
    { id: "p1", name: "A", controllerKind: "human" },
    { id: "p2", name: "B", controllerKind: "ai" },
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

/** Minimal card with an ETB trigger that draws 1 card. */
const etbDrawSrc = `Name:TestETB
ManaCost:1
Types:Creature
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this enters, draw a card.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:When TestETB enters, draw a card.
`;

/** Drain a resolver generator, collecting event kinds. */
const drainResolver = (gen: Generator<unknown, void, unknown>): string[] => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else {
      step = gen.next();
    }
  }
  return events;
};

describe("ChangesZoneTrigger — Part E2 resolver stamping", () => {
  afterEach(() => {
    triggerHandlerRegistry.clear();
    triggerHandlerRegistry.register(ChangesZoneTrigger);
  });
  triggerHandlerRegistry.register(ChangesZoneTrigger);

  it("ETB trigger has a non-null resolver after build()", () => {
    const def = parseCard(etbDrawSrc, "test-etb.txt");
    const paper: PaperCard = {
      name: "TestETB",
      edition: "T",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(100);
    const card = new Card(cardId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);

    card.activateTriggersFromDefinition(game);
    expect(card.triggeredAbilities).toHaveLength(1);
    const ta = card.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability at index 0");
    // The resolver is stamped as a duck-typed property.
    const resolver = (ta as unknown as { resolver?: unknown }).resolver;
    expect(resolver).not.toBeNull();
    expect(resolver).not.toBeUndefined();
    expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
  });

  it("driving the resolver calls DrawEffect and draws a card", () => {
    const def = parseCard(etbDrawSrc, "test-etb.txt");
    const paper: PaperCard = {
      name: "TestETB",
      edition: "T",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(200);
    const card = new Card(cardId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    card.activateTriggersFromDefinition(game);

    // Put a card in the library so draw has something to draw.
    const libraryCardId = mkEntityId(201);
    const libraryCard = new Card(libraryCardId, paper, seat, seat, ZoneType.Library);
    game.cards.set(libraryCardId, libraryCard);
    const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing library zone");
    lib.add(libraryCardId);

    const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    const handSizeBefore = hand.size;

    const ta = card.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability at index 0");
    const resolver = (
      ta as unknown as { resolver: { resolve(g: unknown): Generator<unknown, void, unknown> } }
    ).resolver;
    const events = drainResolver(resolver.resolve(game));

    // CardDrawn should fire
    expect(events).toContain("CardDrawn");
    // Hand should grow by 1
    expect(hand.size).toBe(handSizeBefore + 1);
  });

  it("resolver still works if source card moved to graveyard before resolution", () => {
    // Card leaves battlefield but definition is still on paperCard — resolver should work.
    const def = parseCard(etbDrawSrc, "test-etb.txt");
    const paper: PaperCard = {
      name: "TestETB",
      edition: "T",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(300);
    const card = new Card(cardId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    card.activateTriggersFromDefinition(game);

    // Simulate the card dying — move to graveyard (mutate zone directly)
    card.zone = ZoneType.Graveyard;

    // Still need a card in library
    const libraryCardId = mkEntityId(301);
    const libraryCard = new Card(libraryCardId, paper, seat, seat, ZoneType.Library);
    game.cards.set(libraryCardId, libraryCard);
    const lib2 = game.getPlayer(seat).zones.get(ZoneType.Library);
    if (!lib2) throw new Error("test: missing library zone");
    lib2.add(libraryCardId);

    const ta = card.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability at index 0");
    const resolver = (
      ta as unknown as { resolver: { resolve(g: unknown): Generator<unknown, void, unknown> } }
    ).resolver;
    const events = drainResolver(resolver.resolve(game));

    // Should still fire draw even though card is now in graveyard
    expect(events).toContain("CardDrawn");
  });

  it("resolver throws clearly when Execute$ SVar is missing", () => {
    // Parse a card, then manually tamper with the AST to point to a missing SVar.
    const def = parseCard(etbDrawSrc, "test-etb.txt");
    const paper: PaperCard = {
      name: "TestETB",
      edition: "T",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(400);
    const card = new Card(cardId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);

    // Manually build trigger with a bad executeKey using the registry.
    const badAst: TriggerAst = {
      mode: "ChangesZone",
      params: {
        Origin: { kind: "literal", raw: "Any" },
        Destination: { kind: "literal", raw: "Battlefield" },
        ValidCard: { kind: "literal", raw: "Card.Self" },
      },
      effect: { handlerKey: "NoSuchSVar", params: {} },
    };
    const Cls = triggerHandlerRegistry.lookup("ChangesZone");
    if (!Cls) throw new Error("test: ChangesZoneTrigger not registered");
    const ta = new Cls().build(badAst, {
      game,
      sourceCardId: cardId,
      controllerSeat: seat,
      triggerId: mkEntityId(401),
    });
    const resolver = (
      ta as unknown as { resolver: { resolve(g: unknown): Generator<unknown, void, unknown> } }
    ).resolver;

    expect(() => {
      const gen = resolver.resolve(game);
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/NoSuchSVar/);
  });
});

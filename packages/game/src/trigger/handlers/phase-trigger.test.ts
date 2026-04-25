// SPDX-License-Identifier: GPL-3.0-or-later
// Task 3 — PhaseTrigger tests.
// Part E2 additions: resolver stamping test.
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
// Import for side-effect to register PhaseTrigger at module load time.
import { PhaseTrigger } from "./phase-trigger.js";

// Self-register effects into effectRegistry.
import "../../ability/effects/index.js";
import "../../cost/parts/index.js";

const SOURCE_ID = mkEntityId(20);
const TRIGGER_ID = mkEntityId(2);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkUpkeepAst = (): TriggerAst => ({
  mode: "Phase",
  params: {
    Phase: { kind: "literal", raw: "Upkeep" },
    ValidPlayer: { kind: "literal", raw: "You" },
  },
  effect: { handlerKey: "TrigScry", params: {} },
});

const mkStepStartedEvent = (step: PhaseStep, activeSeat: ReturnType<typeof mkPlayerSeat>) =>
  mkEvent("StepStarted", 1, step, { step, activeSeat });

// Re-register after each clear
afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(PhaseTrigger);
});

// Register before all tests in this file
triggerHandlerRegistry.register(PhaseTrigger);

describe("PhaseTrigger", () => {
  it("is registered under mode 'Phase'", () => {
    expect(triggerHandlerRegistry.has("Phase")).toBe(true);
  });

  describe("Upkeep trigger (ValidPlayer$ You)", () => {
    it("matches when controller's upkeep begins", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const event = mkStepStartedEvent(PhaseStep.Upkeep, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match on opponent's upkeep (ValidPlayer$ You)", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const event = mkStepStartedEvent(PhaseStep.Upkeep, OPPONENT);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match a different step (BeginCombat)", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      const event = mkStepStartedEvent(PhaseStep.BeginCombat, CONTROLLER);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match a non-StepStarted event", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

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

  describe("EndOfTurn alias", () => {
    it("matches EndStep when Phase$ is 'EndOfTurn'", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const eotAst: TriggerAst = {
        mode: "Phase",
        params: {
          Phase: { kind: "literal", raw: "EndOfTurn" },
          ValidPlayer: { kind: "literal", raw: "Each" },
        },
        effect: { handlerKey: "TrigEOT", params: {} },
      };
      const ta = new Cls().build(eotAst, mkCtx());

      const event = mkStepStartedEvent(PhaseStep.EndStep, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });
  });

  describe("ValidPlayer$ Opponent", () => {
    it("fires on opponent's upkeep, not controller's", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ast: TriggerAst = {
        mode: "Phase",
        params: {
          Phase: { kind: "literal", raw: "Upkeep" },
          ValidPlayer: { kind: "literal", raw: "Opponent" },
        },
        effect: { handlerKey: "TrigOpp", params: {} },
      };
      const ta = new Cls().build(ast, mkCtx());

      expect(ta.matches(mkStepStartedEvent(PhaseStep.Upkeep, OPPONENT))).toBe(true);
      expect(ta.matches(mkStepStartedEvent(PhaseStep.Upkeep, CONTROLLER))).toBe(false);
    });
  });

  describe("ValidPlayer$ Each", () => {
    it("fires on any player's draw step", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ast: TriggerAst = {
        mode: "Phase",
        params: {
          Phase: { kind: "literal", raw: "Draw" },
          ValidPlayer: { kind: "literal", raw: "Each" },
        },
        effect: { handlerKey: "TrigEach", params: {} },
      };
      const ta = new Cls().build(ast, mkCtx());

      expect(ta.matches(mkStepStartedEvent(PhaseStep.Draw, CONTROLLER))).toBe(true);
      expect(ta.matches(mkStepStartedEvent(PhaseStep.Draw, OPPONENT))).toBe(true);
    });
  });

  describe("TriggeredAbility identity fields", () => {
    it("has correct id, sourceCardId, kind, isDelayed", () => {
      const Cls = triggerHandlerRegistry.lookup("Phase");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkUpkeepAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
      expect(ta.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Part E2 — PhaseTrigger resolver stamping tests
// ---------------------------------------------------------------------------

const phaseRules: GameRules = {
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
const phaseMeta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkPhaseGame = (): Game => {
  const lobby: LobbyPlayer[] = [
    { id: "p1", name: "A", controllerKind: "human" },
    { id: "p2", name: "B", controllerKind: "ai" },
  ];
  const game = new Game({ lobbyPlayers: lobby, rules: phaseRules, meta: phaseMeta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const drainPhaseResolver = (gen: Generator<unknown, void, unknown>): string[] => {
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

/** Minimal card with an upkeep trigger that draws 1 card. */
const upkeepDrawSrc = `Name:TestUpkeep
ManaCost:1
Types:Creature
PT:1/1
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigDraw | TriggerDescription$ At the beginning of your upkeep, draw a card.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:At the beginning of your upkeep, draw a card.
`;

describe("PhaseTrigger — Part E2 resolver stamping", () => {
  afterEach(() => {
    triggerHandlerRegistry.clear();
    triggerHandlerRegistry.register(PhaseTrigger);
  });
  triggerHandlerRegistry.register(PhaseTrigger);

  it("upkeep trigger has a non-null resolver after build()", () => {
    const def = parseCard(upkeepDrawSrc, "test-upkeep.txt");
    const paper: PaperCard = {
      name: "TestUpkeep",
      edition: "T",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkPhaseGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(500);
    const card = new Card(cardId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);

    card.activateTriggersFromDefinition(game);
    const ta = card.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability at index 0");
    const resolver = (ta as unknown as { resolver?: unknown }).resolver;
    expect(resolver).not.toBeNull();
    expect(resolver).not.toBeUndefined();
    expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
  });

  it("phase trigger resolver drives the linked effect and draws a card", () => {
    const def = parseCard(upkeepDrawSrc, "test-upkeep.txt");
    const paper: PaperCard = {
      name: "TestUpkeep",
      edition: "T",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkPhaseGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(600);
    const card = new Card(cardId, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    card.activateTriggersFromDefinition(game);

    // Put a card in the library
    const libCardId = mkEntityId(601);
    const libCard = new Card(libCardId, paper, seat, seat, ZoneType.Library);
    game.cards.set(libCardId, libCard);
    const phaseLib = game.getPlayer(seat).zones.get(ZoneType.Library);
    if (!phaseLib) throw new Error("test: missing library zone");
    phaseLib.add(libCardId);

    const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    const handSizeBefore = hand.size;

    const ta = card.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability at index 0");
    const resolver = (
      ta as unknown as { resolver: { resolve(g: unknown): Generator<unknown, void, unknown> } }
    ).resolver;
    const events = drainPhaseResolver(resolver.resolve(game));

    expect(events).toContain("CardDrawn");
    expect(hand.size).toBe(handSizeBefore + 1);
  });
});

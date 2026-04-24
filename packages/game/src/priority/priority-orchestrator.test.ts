// SPDX-License-Identifier: GPL-3.0-or-later
// runPriorityWindow tests — CR 117.1 (SP2 Task 40). Drive the generator
// manually to assert SBA/trigger/expired-effect drain ordering and the
// final `priority` decision yield.
import type {
  ContinuousEffect,
  DecisionResponse,
  EntityId,
  GameEvent,
  LastKnownInfo,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  Layer,
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
import type { SbaAction } from "../sba/sba-action.js";
import { SbaEngine } from "../sba/sba-engine.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { runPriorityWindow } from "./priority-orchestrator.js";

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
  name: "Test Card",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  game.phase = PhaseStep.Main1;
  return game;
};

// Phase Step doesn't matter for most tests; main1 picks a canonical value.

const addCard = (game: Game, id: number, seat: PlayerSeat, zone: ZoneType): Card => {
  const cardId = mkEntityId(id);
  const card = new Card(cardId, samplePaper, seat, seat, zone);
  game.cards.set(cardId, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(cardId);
  return card;
};

const mkTriggered = (opts: {
  id: number;
  sourceCardId: EntityId;
  controllerSeat: PlayerSeat;
}): TriggeredAbility => ({
  id: mkEntityId(opts.id),
  kind: "triggered",
  sourceCardId: opts.sourceCardId,
  activeInZones: new Set<ZoneType>([ZoneType.Battlefield]),
  timestamp: 0,
  controllerSeatAtReg: opts.controllerSeat,
  isDelayed: false,
  matches: (_event: GameEvent): boolean => true,
});

const mkLifeEvent = (): GameEvent =>
  mkEvent("LifeChanged", 1, PhaseStep.Main1, {
    playerSeat: mkPlayerSeat(0),
    oldLife: 20,
    newLife: 18,
    delta: -2,
    cause: "effect",
  });

// Drive the generator to completion, feeding responses from `respond`.
interface DriveResult {
  readonly yields: readonly EngineYield[];
  readonly result: { readonly action: unknown } | undefined;
}

const drive = (game: Game, respond: (req: EngineYield) => unknown): DriveResult => {
  const gen = runPriorityWindow(game);
  const yields: EngineYield[] = [];
  let step = gen.next();
  let last: unknown;
  while (!step.done) {
    yields.push(step.value);
    last = respond(step.value);
    step = gen.next(last);
  }
  return { yields, result: step.value };
};

const passResponse = (): DecisionResponse => ({ kind: "priority", action: { kind: "pass" } });

describe("runPriorityWindow (SP2 Task 40, CR 117.1)", () => {
  it("empty game yields only the priority decision once", () => {
    const game = mkGame();
    const { yields, result } = drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));

    // No SBAs, no triggers, no expiries → single decision yielded.
    expect(yields).toHaveLength(1);
    const only = yields[0];
    expect(only?.kind).toBe("decision");
    if (only?.kind === "decision") {
      expect(only.request.kind).toBe("priority");
      if (only.request.kind === "priority") {
        expect(only.request.playerSeat).toBe(game.activePlayer);
        // At least `pass` is always legal.
        expect(only.request.legalActions.some((a) => a.kind === "pass")).toBe(true);
      }
    }
    expect(result?.action).toEqual({ kind: "pass" });
  });

  it("sweeps SBAs before yielding priority", () => {
    const game = mkGame();
    // Install an engine that applies one batch, then goes quiet.
    let calls = 0;
    (game as unknown as { sbaEngine: SbaEngine }).sbaEngine = new (class extends SbaEngine {
      protected override collectApplicable(): SbaAction[] {
        calls += 1;
        if (calls === 1) return [{ kind: "playerLosesLifeZero", seat: mkPlayerSeat(0) }];
        return [];
      }
      override *applyBatch(_actions: readonly SbaAction[]): Generator<EngineYield, void, unknown> {
        // No-op applyBatch so sweep completes without mutating game state.
        if (false as boolean) yield undefined as never;
      }
    })(game);

    const { yields, result } = drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));
    // SBA event(s) appear before the decision.
    const sbaEventIdx = yields.findIndex(
      (y) => y.kind === "event" && y.event.kind === "StateBasedActionApplied",
    );
    const decisionIdx = yields.findIndex((y) => y.kind === "decision");
    expect(sbaEventIdx).toBeGreaterThanOrEqual(0);
    expect(decisionIdx).toBeGreaterThan(sbaEventIdx);
    expect(result?.action).toEqual({ kind: "pass" });
  });

  it("drains triggers into the stack in APNAP order and emits TriggerQueued", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const c0 = addCard(game, 10, seat0, ZoneType.Battlefield);
    const c1 = addCard(game, 11, seat1, ZoneType.Battlefield);
    const t0 = mkTriggered({ id: 100, sourceCardId: c0.id, controllerSeat: seat0 });
    const t1 = mkTriggered({ id: 101, sourceCardId: c1.id, controllerSeat: seat1 });
    game.triggerRegistry.register(t0);
    game.triggerRegistry.register(t1);
    // Fire both with a single canonical event — onEvent populates `pending`.
    game.triggerRegistry.onEvent(mkLifeEvent());
    expect(game.triggerRegistry.peekPending()).toHaveLength(2);

    const { yields, result } = drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));
    // Two TriggerQueued events should have fired.
    const queued = yields.filter((y) => y.kind === "event" && y.event.kind === "TriggerQueued");
    expect(queued).toHaveLength(2);
    // Both items ended up on the stack as "triggeredAbility" entries.
    const stackItems = game.sharedZones.stack.toArray();
    expect(stackItems).toHaveLength(2);
    expect(stackItems.every((s: StackItem) => s.kind === "triggeredAbility")).toBe(true);
    // Decision arrives after the trigger pushes.
    const decisionIdx = yields.findIndex((y) => y.kind === "decision");
    const lastQueuedIdx = yields.reduce(
      (acc, y, i) => (y.kind === "event" && y.event.kind === "TriggerQueued" ? i : acc),
      -1,
    );
    expect(decisionIdx).toBeGreaterThan(lastQueuedIdx);
    expect(result?.action).toEqual({ kind: "pass" });
  });

  it("handles both SBAs and triggers in one window", () => {
    const game = mkGame();
    // A one-shot SBA batch + a trigger. Both drain before priority.
    let sbaCalls = 0;
    (game as unknown as { sbaEngine: SbaEngine }).sbaEngine = new (class extends SbaEngine {
      protected override collectApplicable(): SbaAction[] {
        sbaCalls += 1;
        if (sbaCalls === 1) return [{ kind: "playerLosesLifeZero", seat: mkPlayerSeat(0) }];
        return [];
      }
      override *applyBatch(_actions: readonly SbaAction[]): Generator<EngineYield, void, unknown> {
        if (false as boolean) yield undefined as never;
      }
    })(game);
    const seat0 = mkPlayerSeat(0);
    const c0 = addCard(game, 20, seat0, ZoneType.Battlefield);
    const t0 = mkTriggered({ id: 200, sourceCardId: c0.id, controllerSeat: seat0 });
    game.triggerRegistry.register(t0);
    game.triggerRegistry.onEvent(mkLifeEvent());

    const { yields, result } = drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));
    const sbaIdx = yields.findIndex((y) => y.kind === "event" && y.event.kind === "StateBasedActionApplied");
    const queuedIdx = yields.findIndex((y) => y.kind === "event" && y.event.kind === "TriggerQueued");
    const decisionIdx = yields.findIndex((y) => y.kind === "decision");
    expect(sbaIdx).toBeGreaterThanOrEqual(0);
    expect(queuedIdx).toBeGreaterThan(sbaIdx);
    expect(decisionIdx).toBeGreaterThan(queuedIdx);
    expect(result?.action).toEqual({ kind: "pass" });
  });

  it("drains expired continuous effects and emits ContinuousEffectExpired", () => {
    const game = mkGame();
    // Prime the expired buffer directly: register then expire.
    const effect: ContinuousEffect = {
      id: mkEntityId(500),
      sourceCardId: null,
      timestamp: 1,
      layer: Layer.L7c_PTModify,
      duration: { kind: "untilEndOfTurn" },
      payload: { kind: "pt-modify", effect: { layer: Layer.L7c_PTModify } as never },
    };
    game.continuousEffectRegistry.register(effect);
    // Fire a TurnEnded event to expire untilEndOfTurn effects.
    game.continuousEffectRegistry.onEvent(
      mkEvent("TurnEnded", 1, PhaseStep.Cleanup, {
        activeSeat: mkPlayerSeat(0),
      }),
    );

    const { yields, result } = drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));
    const expiredEvents = yields.filter(
      (y) => y.kind === "event" && y.event.kind === "ContinuousEffectExpired",
    );
    expect(expiredEvents).toHaveLength(1);
    const first = expiredEvents[0];
    if (first?.kind === "event" && first.event.kind === "ContinuousEffectExpired") {
      expect(first.event.payload.effectId).toBe(mkEntityId(500));
    }
    expect(result?.action).toEqual({ kind: "pass" });
  });

  it("iteration terminates when nothing applies (single-pass decision)", () => {
    const game = mkGame();
    const { yields } = drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));
    // Exactly one iteration: nothing did anything → loop breaks after i=0.
    // So no event yields, only the decision.
    expect(yields.filter((y) => y.kind === "event")).toHaveLength(0);
    expect(yields.filter((y) => y.kind === "decision")).toHaveLength(1);
  });

  it("MAX_ITERATIONS throws on pathological SBA input", () => {
    const game = mkGame();
    (game as unknown as { sbaEngine: SbaEngine }).sbaEngine = new (class extends SbaEngine {
      protected override collectApplicable(): SbaAction[] {
        // Never go quiet. The SBA engine has its own MAX_ITERATIONS guard
        // that trips first (100), but that counts as the orchestrator's
        // outer guard too — either way an Error propagates. We only need
        // to assert an error is thrown.
        return [{ kind: "playerLosesLifeZero", seat: mkPlayerSeat(0) }];
      }
      override *applyBatch(_actions: readonly SbaAction[]): Generator<EngineYield, void, unknown> {
        if (false as boolean) yield undefined as never;
      }
    })(game);
    const gen = runPriorityWindow(game);
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next(passResponse());
    }).toThrow();
  });

  it("wrong decision response kind throws IllegalDecisionError", () => {
    const game = mkGame();
    const gen = runPriorityWindow(game);
    // Advance to the priority decision yield.
    const first = gen.next();
    expect(first.done).toBe(false);
    expect(() => gen.next({ kind: "chooseX", x: 2 } as unknown as DecisionResponse)).toThrow(
      IllegalDecisionError,
    );
  });

  it("stacked trigger item carries triggerId and lki", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const c0 = addCard(game, 30, seat0, ZoneType.Battlefield);
    const t0 = mkTriggered({ id: 300, sourceCardId: c0.id, controllerSeat: seat0 });
    // Attach captureLki so the LKI ends up on the PendingTrigger.
    const tWithLki: TriggeredAbility = {
      ...t0,
      captureLki: (): LastKnownInfo =>
        ({
          cardId: c0.id,
          timestamp: 1,
          chars: {} as never,
          zone: ZoneType.Battlefield,
          controllerSeat: seat0,
          tapped: false,
          damage: 0,
        }) as LastKnownInfo,
    };
    game.triggerRegistry.register(tWithLki);
    game.triggerRegistry.onEvent(mkLifeEvent());

    drive(game, (y) => (y.kind === "decision" ? passResponse() : undefined));
    const items = game.sharedZones.stack.toArray();
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first?.triggerId).toBe(mkEntityId(300));
    expect(first?.lki).toBeTruthy();
  });

  it("priority decision carries legalActions", () => {
    const game = mkGame();
    let captured: EntityId | null = null;
    drive(game, (y) => {
      if (y.kind === "decision" && y.request.kind === "priority") {
        captured = captured ?? (y.request.legalActions.length > 0 ? ("ok" as unknown as EntityId) : null);
        return passResponse();
      }
      return undefined;
    });
    expect(captured).not.toBeNull();
  });
});

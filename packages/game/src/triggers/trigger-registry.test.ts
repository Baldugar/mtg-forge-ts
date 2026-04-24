// SPDX-License-Identifier: GPL-3.0-or-later
// TriggerRegistry tests — CR 603 trigger collection (SP2 Task 20) plus
// suppression-filter tests (SP2 Task 24) and LKI preservation (SP2 Task
// 22). Helpers construct a minimal Game via the same pattern used by
// layer-engine.test.ts.
import type {
  DelayedTrigger,
  EntityId,
  GameEvent,
  LastKnownInfo,
  LobbyPlayer,
  PaperCard,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  captureLki,
  emptyCharacteristics,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { SuppressionFilter } from "./trigger-registry.js";

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

const addCard = (g: Game, id: number, seat = 0): EntityId => {
  const cid = mkEntityId(id);
  const card = new Card(cid, grizzlyBears, mkPlayerSeat(seat), mkPlayerSeat(seat), ZoneType.Battlefield);
  g.cards.set(cid, card);
  return cid;
};

interface MkTriggerOpts {
  readonly id: number;
  readonly sourceCardId: number;
  readonly matchesFn?: (e: GameEvent) => boolean;
  readonly interveningIf?: (e: GameEvent, g: unknown) => boolean;
  readonly captureLki?: (e: GameEvent, g: unknown) => unknown;
  readonly isDelayed?: boolean;
  readonly controllerSeatAtReg?: number | null;
}

const mkTrigger = (opts: MkTriggerOpts): TriggeredAbility => {
  const base: TriggeredAbility = {
    id: mkEntityId(opts.id),
    kind: "triggered",
    sourceCardId: mkEntityId(opts.sourceCardId),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg:
      opts.controllerSeatAtReg === undefined
        ? mkPlayerSeat(0)
        : opts.controllerSeatAtReg === null
          ? null
          : mkPlayerSeat(opts.controllerSeatAtReg),
    matches: opts.matchesFn ?? (() => true),
    isDelayed: opts.isDelayed ?? false,
  };
  if (opts.interveningIf) {
    (base as { interveningIf?: (e: GameEvent, g: unknown) => boolean }).interveningIf = opts.interveningIf;
  }
  if (opts.captureLki) {
    (base as { captureLki?: (e: GameEvent, g: unknown) => unknown }).captureLki = opts.captureLki;
  }
  return base;
};

const lifeChangedEvent = (): GameEvent =>
  mkEvent("LifeChanged", 1, PhaseStep.Main1, {
    playerSeat: mkPlayerSeat(0),
    oldLife: 20,
    newLife: 18,
    delta: -2,
    cause: "effect",
  });

describe("TriggerRegistry (CR 603 scaffold)", () => {
  it("register + onEvent with a match-all trigger queues a pending", () => {
    const g = mkGame();
    const cid = addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    const event = lifeChangedEvent();
    g.triggerRegistry.onEvent(event);
    const pending = g.triggerRegistry.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.triggerId).toBe(mkEntityId(1));
    expect(pending[0]?.sourceCardId).toBe(cid);
    expect(pending[0]?.event).toBe(event);
  });

  it("non-matching trigger does not queue", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10, matchesFn: () => false }));
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });

  it("unregister removes the trigger; later onEvent produces no pending", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    g.triggerRegistry.unregister(mkEntityId(1));
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(0);
    expect(g.triggerRegistry.size()).toBe(0);
  });

  it("unregisterAllForCard removes all triggers from that card", () => {
    const g = mkGame();
    addCard(g, 10);
    addCard(g, 11);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    g.triggerRegistry.register(mkTrigger({ id: 2, sourceCardId: 10 }));
    g.triggerRegistry.register(mkTrigger({ id: 3, sourceCardId: 11 }));
    g.triggerRegistry.unregisterAllForCard(mkEntityId(10));
    expect(g.triggerRegistry.size()).toBe(1);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    const pending = g.triggerRegistry.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCardId).toBe(mkEntityId(11));
  });

  it("drain returns pending and clears it", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(1);
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });

  it("peekPending returns pending without clearing", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.peekPending()).toHaveLength(1);
    expect(g.triggerRegistry.peekPending()).toHaveLength(1); // still there
    expect(g.triggerRegistry.drain()).toHaveLength(1);
  });

  it("sourceControllerAtFire reflects current controller after changeControl", () => {
    const g = mkGame();
    const cid = addCard(g, 10, 0);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    // Simulate a control change (direct mutation; GameAction.changeControl
    // is tested elsewhere and not the subject here).
    const card = g.cards.get(cid);
    if (card) card.controllerSeat = mkPlayerSeat(1);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    const pending = g.triggerRegistry.drain();
    expect(pending[0]?.sourceControllerAtFire).toBe(mkPlayerSeat(1));
  });

  it("interveningIf false at fire time drops the trigger (not in pending)", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(
      mkTrigger({
        id: 1,
        sourceCardId: 10,
        interveningIf: () => false,
      }),
    );
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });

  it("interveningIf true at fire time queues the trigger", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10, interveningIf: () => true }));
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(1);
  });

  it("captureLki hook is invoked and the LKI attached to the pending entry", () => {
    const g = mkGame();
    const cid = addCard(g, 10);
    let captured = false;
    const lkiSample = captureLki({
      cardId: cid,
      timestamp: 1,
      chars: emptyCharacteristics(),
      zone: ZoneType.Battlefield,
      controllerSeat: mkPlayerSeat(0),
      tapped: false,
      damage: 0,
    });
    g.triggerRegistry.register(
      mkTrigger({
        id: 1,
        sourceCardId: 10,
        captureLki: () => {
          captured = true;
          return lkiSample;
        },
      }),
    );
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(captured).toBe(true);
    const pending = g.triggerRegistry.drain();
    expect(pending[0]?.lki).toBe(lkiSample);
  });

  it("registering the same id twice overwrites (id is the primary key)", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10, matchesFn: () => false }));
    expect(g.triggerRegistry.size()).toBe(1);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10, matchesFn: () => true }));
    expect(g.triggerRegistry.size()).toBe(1);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(1);
  });

  it("Game.emitEvent routes canonical events to the registry", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    const yld = g.emitEvent(lifeChangedEvent());
    expect(yld.kind).toBe("event");
    expect(g.triggerRegistry.drain()).toHaveLength(1);
  });

  it("Game.emitEvent does NOT route engine-internal kinds to the registry", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    const ev = mkEvent("ReplacementApplied", 1, PhaseStep.Main1, {
      replacementId: mkEntityId(999),
      original: {},
      replaced: null,
    });
    g.emitEvent(ev);
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });

  it("Task 22: LKI captured at fire time is preserved even after card state mutates", () => {
    const g = mkGame();
    const cid = addCard(g, 10);
    const card = g.cards.get(cid);
    if (!card) throw new Error("card missing");
    card.tapped = false;
    card.counters.set("p1p1" as unknown as never, 0);
    // Snapshot what "tapped" and counters look like at fire time.
    const lkiSample = captureLki({
      cardId: cid,
      timestamp: 1,
      chars: emptyCharacteristics(),
      zone: ZoneType.Battlefield,
      controllerSeat: mkPlayerSeat(0),
      tapped: false,
      damage: 0,
    });
    g.triggerRegistry.register(
      mkTrigger({
        id: 1,
        sourceCardId: 10,
        captureLki: () => lkiSample,
      }),
    );
    g.triggerRegistry.onEvent(lifeChangedEvent());
    // Mutate the card AFTER fire but BEFORE drain — LKI must not see it.
    card.tapped = true;
    card.damage = 99;
    const pending = g.triggerRegistry.drain();
    const capturedLki = pending[0]?.lki as LastKnownInfo;
    expect(capturedLki.tapped).toBe(false);
    expect(capturedLki.damage).toBe(0);
  });

  it("Task 24: suppression filter drops matching triggers (by sourceCardId)", () => {
    const g = mkGame();
    addCard(g, 10);
    addCard(g, 11);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    g.triggerRegistry.register(mkTrigger({ id: 2, sourceCardId: 11 }));
    const filter: SuppressionFilter = (trigger) => trigger.sourceCardId === mkEntityId(10);
    g.triggerRegistry.addSuppressionFilter(filter);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    const pending = g.triggerRegistry.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCardId).toBe(mkEntityId(11));
  });

  it("Task 24: removeSuppressionFilter re-enables the dropped trigger", () => {
    const g = mkGame();
    addCard(g, 10);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    const filter: SuppressionFilter = () => true;
    g.triggerRegistry.addSuppressionFilter(filter);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(0);
    g.triggerRegistry.removeSuppressionFilter(filter);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(1);
  });

  it("Task 24: multiple suppression filters combine disjunctively", () => {
    const g = mkGame();
    addCard(g, 10);
    addCard(g, 11);
    g.triggerRegistry.register(mkTrigger({ id: 1, sourceCardId: 10 }));
    g.triggerRegistry.register(mkTrigger({ id: 2, sourceCardId: 11 }));
    const filterA: SuppressionFilter = (t) => t.sourceCardId === mkEntityId(10);
    const filterB: SuppressionFilter = (t) => t.sourceCardId === mkEntityId(11);
    g.triggerRegistry.addSuppressionFilter(filterA);
    g.triggerRegistry.addSuppressionFilter(filterB);
    g.triggerRegistry.onEvent(lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });

  it("Task 24: suppression also applies to delayed triggers via onEventForcedByDelayed", () => {
    const g = mkGame();
    addCard(g, 10);
    const delayed: DelayedTrigger = {
      id: mkEntityId(42),
      kind: "triggered",
      isDelayed: true,
      sourceCardId: mkEntityId(10),
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      createdAtTurn: 1,
      creationContext: {},
      oneShot: true,
      matches: () => true,
    };
    g.triggerRegistry.addSuppressionFilter(() => true);
    g.triggerRegistry.onEventForcedByDelayed(delayed, lifeChangedEvent());
    expect(g.triggerRegistry.drain()).toHaveLength(0);
  });
});

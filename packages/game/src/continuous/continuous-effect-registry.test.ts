// SPDX-License-Identifier: GPL-3.0-or-later
import type { ContinuousEffect, LobbyPlayer } from "@mtg-forge-ts/core";
import { Layer, PhaseStep, SeededRng, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { TypeChangeEffect } from "../layers/layer4-type.js";
import type { Layer7cEffect } from "../layers/layer7-pt.js";

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

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const mkPtModifyEffect = (id: number, duration: ContinuousEffect["duration"]): ContinuousEffect => {
  const pt: Layer7cEffect = {
    layer: Layer.L7c_PTModify,
    timestamp: 1,
    sourceAbilityId: null,
    power: 1,
    toughness: 1,
  } as unknown as Layer7cEffect;
  return {
    id: mkEntityId(id),
    sourceCardId: mkEntityId(id + 1),
    timestamp: 1,
    layer: Layer.L7c_PTModify,
    duration,
    payload: { kind: "pt-modify", effect: pt },
  };
};

const mkTypeEffect = (id: number, duration: ContinuousEffect["duration"]): ContinuousEffect => {
  const t: TypeChangeEffect = {
    layer: Layer.L4_Type,
    timestamp: 2,
    sourceAbilityId: null,
  } as unknown as TypeChangeEffect;
  return {
    id: mkEntityId(id),
    sourceCardId: mkEntityId(id + 1),
    timestamp: 2,
    layer: Layer.L4_Type,
    duration,
    payload: { kind: "type", effect: t },
  };
};

describe("ContinuousEffectRegistry (SP2 Task 33)", () => {
  it("is wired on the Game", () => {
    const game = mkGame();
    expect(game.continuousEffectRegistry).toBeDefined();
    expect(game.continuousEffectRegistry.size()).toBe(0);
  });

  it("register inserts into the registry and mirrors to game.continuousEffects", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    expect(game.continuousEffectRegistry.size()).toBe(1);
    expect(game.continuousEffects).toHaveLength(1);
    expect(game.continuousEffects[0]?.id).toBe(e.id);
  });

  it("register pushes the payload into the matching LayerEngine array", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    expect(game.layerEngine.pt7c).toHaveLength(1);
    const t = mkTypeEffect(3, { kind: "permanent" });
    game.continuousEffectRegistry.register(t);
    expect(game.layerEngine.typeEffects).toHaveLength(1);
  });

  it("register bumps the LayerEngine epoch", () => {
    const game = mkGame();
    const e0 = game.layerEngine.currentEpoch;
    game.continuousEffectRegistry.register(mkPtModifyEffect(1, { kind: "untilEndOfTurn" }));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(e0);
  });

  it("unregister removes from registry, game.continuousEffects, and layer arrays", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    game.continuousEffectRegistry.unregister(e.id);
    expect(game.continuousEffectRegistry.size()).toBe(0);
    expect(game.continuousEffects).toHaveLength(0);
    expect(game.layerEngine.pt7c).toHaveLength(0);
  });

  it("unregister of unknown id is a no-op", () => {
    const game = mkGame();
    expect(() => game.continuousEffectRegistry.unregister(mkEntityId(999))).not.toThrow();
  });

  it("onEvent(TurnEnded) expires untilEndOfTurn effects into drain buffer", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    game.continuousEffectRegistry.onEvent(turnEnded);
    expect(game.continuousEffectRegistry.size()).toBe(0);
    const drained = game.continuousEffectRegistry.drainExpired();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.id).toBe(e.id);
  });

  it("onEvent does not expire effects whose duration does not match", () => {
    const game = mkGame();
    const permanentE = mkPtModifyEffect(1, { kind: "permanent" });
    const turnE = mkPtModifyEffect(3, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(permanentE);
    game.continuousEffectRegistry.register(turnE);
    const stepEnded = mkEvent("StepEnded", 1, PhaseStep.Main1, {
      activeSeat: mkPlayerSeat(0),
      step: PhaseStep.Main1,
    });
    game.continuousEffectRegistry.onEvent(stepEnded);
    expect(game.continuousEffectRegistry.size()).toBe(2);
    expect(game.continuousEffectRegistry.drainExpired()).toHaveLength(0);
  });

  it("drainExpired empties the buffer after drain", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
    game.continuousEffectRegistry.onEvent(turnEnded);
    expect(game.continuousEffectRegistry.drainExpired()).toHaveLength(1);
    // Second drain returns empty.
    expect(game.continuousEffectRegistry.drainExpired()).toHaveLength(0);
  });

  it("Game.emitEvent routes events into the registry", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    game.emitEvent(mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) }));
    expect(game.continuousEffectRegistry.size()).toBe(0);
    expect(game.continuousEffectRegistry.drainExpired()).toHaveLength(1);
  });

  // Audit A-001 regression — PhaseStepEnded must flow into the registry so
  // `untilEndOfNextStep` effects expire. Earlier the kind was on the
  // engine-internal denylist in Game.emitEvent; this test locks the wiring.
  it("Game.emitEvent(PhaseStepEnded) expires untilEndOfNextStep effects", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, {
      kind: "untilEndOfNextStep",
      step: PhaseStep.EndOfCombat,
    });
    game.continuousEffectRegistry.register(e);
    game.emitEvent(mkEvent("PhaseStepEnded", 1, PhaseStep.EndOfCombat, { step: PhaseStep.EndOfCombat }));
    expect(game.continuousEffectRegistry.size()).toBe(0);
    const drained = game.continuousEffectRegistry.drainExpired();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.id).toBe(e.id);
  });

  it("multiple effects expire independently per their duration", () => {
    const game = mkGame();
    const turnE = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    const combatE = mkPtModifyEffect(3, { kind: "untilCombatEnds" });
    const permanentE = mkPtModifyEffect(5, { kind: "permanent" });
    game.continuousEffectRegistry.register(turnE);
    game.continuousEffectRegistry.register(combatE);
    game.continuousEffectRegistry.register(permanentE);
    game.continuousEffectRegistry.onEvent(
      mkEvent("CombatEnded", 1, PhaseStep.EndOfCombat, { attackingSeat: mkPlayerSeat(0) }),
    );
    const drained1 = game.continuousEffectRegistry.drainExpired();
    expect(drained1).toHaveLength(1);
    expect(drained1[0]?.id).toBe(combatE.id);
    game.continuousEffectRegistry.onEvent(
      mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) }),
    );
    const drained2 = game.continuousEffectRegistry.drainExpired();
    expect(drained2).toHaveLength(1);
    expect(drained2[0]?.id).toBe(turnE.id);
    // permanentE still there.
    expect(game.continuousEffectRegistry.size()).toBe(1);
  });

  it("re-register of same id replaces cleanly (no layer-array accumulation)", () => {
    const game = mkGame();
    const e = mkPtModifyEffect(1, { kind: "untilEndOfTurn" });
    game.continuousEffectRegistry.register(e);
    game.continuousEffectRegistry.register(e);
    expect(game.continuousEffectRegistry.size()).toBe(1);
    expect(game.layerEngine.pt7c).toHaveLength(1);
  });

  // Wave 9 — cleanup hook ensures out-of-layer-engine mutations (e.g. direct
  // card.keywords additions for Protection) are reversed when the effect ends.
  describe("registerCleanup (Wave 9)", () => {
    it("invokes the cleanup hook on natural expiry via TurnEnded", () => {
      const game = mkGame();
      const e = mkPtModifyEffect(50, { kind: "untilEndOfTurn" });
      game.continuousEffectRegistry.register(e);
      let cleanupRan = 0;
      game.continuousEffectRegistry.registerCleanup(e.id, () => {
        cleanupRan++;
      });
      const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
      game.continuousEffectRegistry.onEvent(turnEnded);
      expect(cleanupRan).toBe(1);
      expect(game.continuousEffectRegistry.size()).toBe(0);
    });

    it("invokes the cleanup hook on explicit unregister", () => {
      const game = mkGame();
      const e = mkPtModifyEffect(60, { kind: "permanent" });
      game.continuousEffectRegistry.register(e);
      let cleanupSawGame: Game | undefined;
      game.continuousEffectRegistry.registerCleanup(e.id, (g) => {
        cleanupSawGame = g;
      });
      game.continuousEffectRegistry.unregister(e.id);
      expect(cleanupSawGame).toBe(game);
    });

    it("does not invoke the hook twice across two unregisters", () => {
      const game = mkGame();
      const e = mkPtModifyEffect(70, { kind: "permanent" });
      game.continuousEffectRegistry.register(e);
      let cleanupRan = 0;
      game.continuousEffectRegistry.registerCleanup(e.id, () => {
        cleanupRan++;
      });
      game.continuousEffectRegistry.unregister(e.id);
      game.continuousEffectRegistry.unregister(e.id);
      expect(cleanupRan).toBe(1);
    });

    it("registerCleanup before register also fires when the effect later expires", () => {
      const game = mkGame();
      const e = mkPtModifyEffect(80, { kind: "untilEndOfTurn" });
      let cleanupRan = 0;
      game.continuousEffectRegistry.registerCleanup(e.id, () => {
        cleanupRan++;
      });
      game.continuousEffectRegistry.register(e);
      const turnEnded = mkEvent("TurnEnded", 1, PhaseStep.Cleanup, { activeSeat: mkPlayerSeat(0) });
      game.continuousEffectRegistry.onEvent(turnEnded);
      expect(cleanupRan).toBe(1);
    });
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 66 — requestShortcut engine primitive (CR 725 loop detection).
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { IllegalDecisionError, SeededRng, mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { type LoopShortcutResult, requestShortcut } from "./loop-shortcut.js";

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
  return new Game({ lobbyPlayers: lobby, rules, meta, rng: new SeededRng(1n) });
};

const drain = (gen: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    out.push(step.value);
    step = gen.next();
  }
  return out;
};

describe("requestShortcut (SP2 Task 66 — CR 725)", () => {
  it("valid shortcut emits ShortcutApplied with description + affected list", () => {
    const game = mkGame();
    const affected = [mkEntityId(10), mkEntityId(11)];
    const result: LoopShortcutResult = { description: "life-drain loop", loopCount: 7, affected };
    const yields = drain(requestShortcut(game, "life-drain loop", result));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "ShortcutApplied");
    if (!ev || ev.kind !== "event" || ev.event.kind !== "ShortcutApplied") {
      throw new Error("expected ShortcutApplied event");
    }
    expect(ev.event.payload.description).toBe("life-drain loop");
    expect(ev.event.payload.affected).toEqual(affected);
  });

  it("loopCount=0 is accepted (short-circuit shortcut)", () => {
    const game = mkGame();
    const yields = drain(
      requestShortcut(game, "no-op loop", { description: "no-op loop", loopCount: 0, affected: [] }),
    );
    expect(yields.filter((y) => y.kind === "event" && y.event.kind === "ShortcutApplied")).toHaveLength(1);
  });

  it("empty description throws IllegalDecisionError", () => {
    const game = mkGame();
    const gen = requestShortcut(game, "", { description: "", loopCount: 1, affected: [] });
    expect(() => gen.next()).toThrow(IllegalDecisionError);
  });

  it("negative loopCount throws", () => {
    const game = mkGame();
    const gen = requestShortcut(game, "bad", { description: "bad", loopCount: -1, affected: [] });
    expect(() => gen.next()).toThrow(IllegalDecisionError);
  });

  it("non-integer loopCount throws", () => {
    const game = mkGame();
    const gen = requestShortcut(game, "bad", { description: "bad", loopCount: 1.5, affected: [] });
    expect(() => gen.next()).toThrow(IllegalDecisionError);
  });

  it("NaN loopCount throws", () => {
    const game = mkGame();
    const gen = requestShortcut(game, "bad", {
      description: "bad",
      loopCount: Number.NaN,
      affected: [],
    });
    expect(() => gen.next()).toThrow(IllegalDecisionError);
  });

  it("finalState is preserved in the descriptor but ignored by SP2", () => {
    const game = mkGame();
    // finalState is an opaque slot — SP2 doesn't touch game state, just
    // validates + emits.
    const result: LoopShortcutResult = {
      description: "loop",
      loopCount: 3,
      affected: [mkEntityId(1)],
      finalState: { someOpaquePayload: true },
    };
    const yields = drain(requestShortcut(game, "loop", result));
    expect(yields).toHaveLength(1);
    // Game state untouched (no players mutated; no cards added).
    expect(game.cards.size).toBe(0);
  });

  it("GameAction.requestShortcut routes through the primitive", () => {
    const game = mkGame();
    const yields = drain(
      game.action.requestShortcut("via action", {
        description: "via action",
        loopCount: 2,
        affected: [],
      }),
    );
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "ShortcutApplied");
    expect(ev).toBeDefined();
  });
});

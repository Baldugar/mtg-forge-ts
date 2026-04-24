// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer } from "@mtg-forge-ts/core";
import { SeededRng, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";
import { SbaEngine } from "./sba-engine.js";

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

const runSweep = (
  engine: SbaEngine,
): { readonly yields: EngineYield[]; readonly batches: readonly (readonly SbaAction[])[] } => {
  const yields: EngineYield[] = [];
  const gen = engine.sweep();
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return { yields, batches: step.value };
};

describe("SbaEngine — skeleton + fixpoint loop (SP2 Task 29)", () => {
  it("empty game with no SBAs applicable returns empty batches and yields nothing", () => {
    const game = mkGame();
    const { yields, batches } = runSweep(game.sbaEngine);
    expect(batches).toEqual([]);
    expect(yields).toEqual([]);
  });

  it("sbaEngine is wired on the Game", () => {
    const game = mkGame();
    expect(game.sbaEngine).toBeInstanceOf(SbaEngine);
  });

  it("emits StateBasedActionApplied with actionCount per batch", () => {
    const game = mkGame();
    // Fire a fixed batch once, then go empty to terminate the fixpoint.
    let called = 0;
    const engine = new (class extends SbaEngine {
      protected override collectApplicable(): SbaAction[] {
        called += 1;
        if (called === 1) {
          return [
            { kind: "playerLosesLifeZero", seat: mkPlayerSeat(0) },
            { kind: "playerLosesLifeZero", seat: mkPlayerSeat(1) },
          ];
        }
        return [];
      }
      // Skip apply() side-effects — the base class's no-op apply is fine.
    })(game);

    const { yields, batches } = runSweep(engine);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    const sbaEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "StateBasedActionApplied");
    expect(sbaEvents).toHaveLength(1);
    const ev = sbaEvents[0];
    if (ev?.kind !== "event") throw new Error("event expected");
    expect(ev.event.payload).toEqual({ actionCount: 2 });
  });

  it("records batches in order across fixpoint iterations", () => {
    const game = mkGame();
    let iter = 0;
    const engine = new (class extends SbaEngine {
      protected override collectApplicable(): SbaAction[] {
        iter += 1;
        if (iter === 1) return [{ kind: "playerLosesLifeZero", seat: mkPlayerSeat(0) }];
        if (iter === 2) return [{ kind: "playerLosesLifeZero", seat: mkPlayerSeat(1) }];
        return [];
      }
    })(game);

    const { batches } = runSweep(engine);
    expect(batches).toHaveLength(2);
    const b0 = batches[0];
    const b1 = batches[1];
    if (!b0 || !b1) throw new Error("batches expected");
    expect(b0[0]?.kind).toBe("playerLosesLifeZero");
    if (b0[0]?.kind !== "playerLosesLifeZero") throw new Error("kind mismatch");
    expect(b0[0].seat).toBe(mkPlayerSeat(0));
    if (b1[0]?.kind !== "playerLosesLifeZero") throw new Error("kind mismatch");
    expect(b1[0].seat).toBe(mkPlayerSeat(1));
  });

  it("throws when the fixpoint loop exceeds MAX_ITERATIONS", () => {
    const game = mkGame();
    const engine = new (class extends SbaEngine {
      protected override collectApplicable(): SbaAction[] {
        // Always return a non-empty action — a bugged collector that never
        // clears. The base engine should bail out.
        return [{ kind: "playerLosesLifeZero", seat: mkPlayerSeat(0) }];
      }
    })(game);

    expect(() => {
      const gen = engine.sweep();
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(/exceeded 100 iterations/);
  });
});

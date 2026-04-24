// SPDX-License-Identifier: GPL-3.0-or-later
// StaticEffectRegistry tests — CR 604 scaffold (SP2 Task 25).
import type { LobbyPlayer, StaticAbility, StaticAbilityCategory } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";

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

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const mkStatic = (opts: {
  id: number;
  sourceCardId: number;
  category?: StaticAbilityCategory;
  describe?: () => unknown;
  activeInZones?: ReadonlySet<ZoneType>;
}): StaticAbility => ({
  id: mkEntityId(opts.id),
  kind: "static",
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: opts.activeInZones ?? new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  category: opts.category ?? "cantMustMay",
  describe: opts.describe ?? (() => null),
});

describe("StaticEffectRegistry (CR 604 scaffold)", () => {
  it("register + get retrieves the registered static by id", () => {
    const game = makeGame();
    const s = mkStatic({ id: 1, sourceCardId: 10 });
    game.staticEffectRegistry.register(s);
    expect(game.staticEffectRegistry.get(mkEntityId(1))).toBe(s);
    expect(game.staticEffectRegistry.size()).toBe(1);
  });

  it("byCategory returns matching statics and excludes non-matches", () => {
    const game = makeGame();
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, category: "cantMustMay" }));
    game.staticEffectRegistry.register(mkStatic({ id: 2, sourceCardId: 11, category: "costModification" }));
    game.staticEffectRegistry.register(mkStatic({ id: 3, sourceCardId: 12, category: "cantMustMay" }));
    expect(game.staticEffectRegistry.byCategory("cantMustMay")).toHaveLength(2);
    expect(game.staticEffectRegistry.byCategory("costModification")).toHaveLength(1);
    expect(game.staticEffectRegistry.byCategory("ruleChanging")).toHaveLength(0);
  });

  it("byCard returns statics sourced by a specific card", () => {
    const game = makeGame();
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10 }));
    game.staticEffectRegistry.register(mkStatic({ id: 2, sourceCardId: 10 }));
    game.staticEffectRegistry.register(mkStatic({ id: 3, sourceCardId: 11 }));
    expect(game.staticEffectRegistry.byCard(mkEntityId(10))).toHaveLength(2);
    expect(game.staticEffectRegistry.byCard(mkEntityId(11))).toHaveLength(1);
    expect(game.staticEffectRegistry.byCard(mkEntityId(99))).toHaveLength(0);
  });

  it("unregister removes the static and tidies bySourceCard index", () => {
    const game = makeGame();
    const s = mkStatic({ id: 1, sourceCardId: 10 });
    game.staticEffectRegistry.register(s);
    game.staticEffectRegistry.unregister(mkEntityId(1));
    expect(game.staticEffectRegistry.size()).toBe(0);
    expect(game.staticEffectRegistry.byCard(mkEntityId(10))).toHaveLength(0);
    expect(game.staticEffectRegistry.get(mkEntityId(1))).toBeUndefined();
  });

  it("unregister of an unknown id is a no-op", () => {
    const game = makeGame();
    game.staticEffectRegistry.unregister(mkEntityId(999));
    expect(game.staticEffectRegistry.size()).toBe(0);
  });

  it("unregisterAllForCard removes every static from that source", () => {
    const game = makeGame();
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10 }));
    game.staticEffectRegistry.register(mkStatic({ id: 2, sourceCardId: 10 }));
    game.staticEffectRegistry.register(mkStatic({ id: 3, sourceCardId: 11 }));
    game.staticEffectRegistry.unregisterAllForCard(mkEntityId(10));
    expect(game.staticEffectRegistry.size()).toBe(1);
    expect(game.staticEffectRegistry.byCard(mkEntityId(10))).toHaveLength(0);
    expect(game.staticEffectRegistry.byCard(mkEntityId(11))).toHaveLength(1);
  });

  it("all() returns every registered static", () => {
    const game = makeGame();
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10 }));
    game.staticEffectRegistry.register(mkStatic({ id: 2, sourceCardId: 11 }));
    expect(game.staticEffectRegistry.all()).toHaveLength(2);
  });

  it("re-register with same id overwrites and keeps the index consistent", () => {
    const game = makeGame();
    const s1 = mkStatic({ id: 1, sourceCardId: 10, category: "cantMustMay" });
    const s2 = mkStatic({ id: 1, sourceCardId: 10, category: "costModification" });
    game.staticEffectRegistry.register(s1);
    game.staticEffectRegistry.register(s2);
    expect(game.staticEffectRegistry.size()).toBe(1);
    expect(game.staticEffectRegistry.get(mkEntityId(1))).toBe(s2);
    expect(game.staticEffectRegistry.byCard(mkEntityId(10))).toHaveLength(1);
  });

  it("re-register with same id but different source card migrates the index", () => {
    const game = makeGame();
    const s1 = mkStatic({ id: 1, sourceCardId: 10 });
    const s2 = mkStatic({ id: 1, sourceCardId: 20 });
    game.staticEffectRegistry.register(s1);
    game.staticEffectRegistry.register(s2);
    expect(game.staticEffectRegistry.byCard(mkEntityId(10))).toHaveLength(0);
    expect(game.staticEffectRegistry.byCard(mkEntityId(20))).toHaveLength(1);
  });

  it("empty registry reports size 0 and empty category/card/all lookups", () => {
    const game = makeGame();
    expect(game.staticEffectRegistry.size()).toBe(0);
    expect(game.staticEffectRegistry.all()).toEqual([]);
    expect(game.staticEffectRegistry.byCategory("continuous")).toEqual([]);
    expect(game.staticEffectRegistry.byCard(mkEntityId(1))).toEqual([]);
  });
});

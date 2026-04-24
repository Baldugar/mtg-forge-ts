// SPDX-License-Identifier: GPL-3.0-or-later
// Cost-mod contributor tests (SP2 Task 27). Exercise the gather surface
// with matching + non-matching filters; verify envelope + bare payload
// shapes; verify non-costMod categories are ignored.
import type { LobbyPlayer, StaticAbility } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { CostModEffect } from "./cost-mod-contributor.js";
import { gatherCostModsFor } from "./cost-mod-contributor.js";

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
  payload: unknown;
  category?: "costModification" | "cantMustMay" | "continuous";
}): StaticAbility => ({
  id: mkEntityId(opts.id),
  kind: "static",
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  category: opts.category ?? "costModification",
  describe: () => opts.payload,
});

describe("gatherCostModsFor (SP2 Task 27)", () => {
  it("returns a cost-mod whose filter matches the stack item", () => {
    const game = makeGame();
    const effect: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: (item) => (item as { name?: string }).name === "Goblin",
      delta: { generic: -1 },
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: effect }));
    const hits = gatherCostModsFor(game, { name: "Goblin" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.delta.generic).toBe(-1);
  });

  it("filters out cost-mods whose filter rejects the item", () => {
    const game = makeGame();
    const effect: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: (item) => (item as { name?: string }).name === "Goblin",
      delta: { generic: -1 },
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: effect }));
    expect(gatherCostModsFor(game, { name: "Dragon" })).toHaveLength(0);
  });

  it("returns multiple matching cost-mods for the same stack item", () => {
    const game = makeGame();
    const a: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: -1 },
    };
    const b: CostModEffect = {
      sourceStaticId: mkEntityId(2),
      filter: () => true,
      delta: { generic: -2 },
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: a }));
    game.staticEffectRegistry.register(mkStatic({ id: 2, sourceCardId: 11, payload: b }));
    const hits = gatherCostModsFor(game, {});
    expect(hits).toHaveLength(2);
  });

  it("ignores non-costModification statics entirely", () => {
    const game = makeGame();
    const effect: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: -1 },
    };
    // Register a cantMustMay static with a plausibly-shaped payload —
    // gather should only scan the costModification bucket.
    game.staticEffectRegistry.register(
      mkStatic({ id: 1, sourceCardId: 10, payload: effect, category: "cantMustMay" }),
    );
    expect(gatherCostModsFor(game, {})).toHaveLength(0);
  });

  it("accepts envelope-shaped describe() payloads { kind: 'costMod', effect }", () => {
    const game = makeGame();
    const effect: CostModEffect = {
      sourceStaticId: mkEntityId(1),
      filter: () => true,
      delta: { generic: -1 },
    };
    game.staticEffectRegistry.register(
      mkStatic({ id: 1, sourceCardId: 10, payload: { kind: "costMod", effect } }),
    );
    const hits = gatherCostModsFor(game, {});
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(effect);
  });

  it("empty registry returns no cost-mods", () => {
    const game = makeGame();
    expect(gatherCostModsFor(game, {})).toHaveLength(0);
  });
});

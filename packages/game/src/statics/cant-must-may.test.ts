// SPDX-License-Identifier: GPL-3.0-or-later
// can't/must/may contributor tests (SP2 Task 27). Exercise the
// gatherRestrictions + isRestricted surfaces across multiple
// restriction kinds and subject filters.
import type { LobbyPlayer, StaticAbility } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { Restriction } from "./cant-must-may.js";
import { gatherRestrictions, isRestricted } from "./cant-must-may.js";
import type { RestrictionKind } from "./cant-must-may.js";

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
  category?: "cantMustMay" | "costModification" | "continuous";
}): StaticAbility => ({
  id: mkEntityId(opts.id),
  kind: "static",
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  category: opts.category ?? "cantMustMay",
  mode: "Continuous",
  describe: () => opts.payload,
});

describe("cantMustMay restrictions (SP2 Task 27)", () => {
  it("gatherRestrictions returns restrictions with matching kind", () => {
    const game = makeGame();
    const r: Restriction = {
      sourceStaticId: mkEntityId(1),
      kind: "cantAttack",
      subjectFilter: () => true,
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: r }));
    expect(gatherRestrictions(game, "cantAttack")).toHaveLength(1);
    expect(gatherRestrictions(game, "mustAttack")).toHaveLength(0);
  });

  it("isRestricted returns true when a matching restriction accepts the subject", () => {
    const game = makeGame();
    const r: Restriction = {
      sourceStaticId: mkEntityId(1),
      kind: "cantAttack",
      subjectFilter: (id) => id === mkEntityId(42),
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: r }));
    expect(isRestricted(game, "cantAttack", mkEntityId(42))).toBe(true);
    expect(isRestricted(game, "cantAttack", mkEntityId(43))).toBe(false);
  });

  it("isRestricted returns false for a kind that has no registrations", () => {
    const game = makeGame();
    expect(isRestricted(game, "mustBlock", mkEntityId(1))).toBe(false);
  });

  it("multiple restriction kinds coexist — each gather scope is isolated", () => {
    const game = makeGame();
    const cantAttack: Restriction = {
      sourceStaticId: mkEntityId(1),
      kind: "cantAttack",
      subjectFilter: () => true,
    };
    const cantBlock: Restriction = {
      sourceStaticId: mkEntityId(2),
      kind: "cantBlock",
      subjectFilter: () => true,
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: cantAttack }));
    game.staticEffectRegistry.register(mkStatic({ id: 2, sourceCardId: 11, payload: cantBlock }));
    expect(gatherRestrictions(game, "cantAttack")).toHaveLength(1);
    expect(gatherRestrictions(game, "cantBlock")).toHaveLength(1);
    expect(gatherRestrictions(game, "cantCast")).toHaveLength(0);
  });

  it("subject filter discriminates between subjects", () => {
    const game = makeGame();
    const r: Restriction = {
      sourceStaticId: mkEntityId(1),
      kind: "cantBlock",
      subjectFilter: (id) => id === mkPlayerSeat(1),
    };
    game.staticEffectRegistry.register(mkStatic({ id: 1, sourceCardId: 10, payload: r }));
    expect(isRestricted(game, "cantBlock", mkPlayerSeat(1))).toBe(true);
    expect(isRestricted(game, "cantBlock", mkPlayerSeat(0))).toBe(false);
  });

  it("ignores non-cantMustMay statics entirely", () => {
    const game = makeGame();
    const r: Restriction = {
      sourceStaticId: mkEntityId(1),
      kind: "cantAttack",
      subjectFilter: () => true,
    };
    game.staticEffectRegistry.register(
      mkStatic({ id: 1, sourceCardId: 10, payload: r, category: "costModification" }),
    );
    expect(gatherRestrictions(game, "cantAttack")).toHaveLength(0);
  });

  it("accepts envelope-shaped describe() payloads { kind: 'restriction', effect }", () => {
    const game = makeGame();
    const r: Restriction = {
      sourceStaticId: mkEntityId(1),
      kind: "cantCast",
      subjectFilter: () => true,
    };
    game.staticEffectRegistry.register(
      mkStatic({ id: 1, sourceCardId: 10, payload: { kind: "restriction", effect: r } }),
    );
    expect(gatherRestrictions(game, "cantCast")).toHaveLength(1);
  });
});

describe("RestrictionKind expansion", () => {
  it("covers the action-filter subset (11 kinds)", () => {
    const kinds: RestrictionKind[] = [
      "cantCast",
      "cantActivate",
      "cantAttack",
      "mustAttack",
      "cantBlock",
      "mustBlock",
      "cantTarget",
      "cantUntap",
      "mustTarget",
      "cantPhaseIn",
      "cantPhaseOut",
    ];
    expect(kinds).toHaveLength(11);
  });
});

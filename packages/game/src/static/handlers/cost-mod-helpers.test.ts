// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 11 — unit tests for cost-mod helper functions.
import type { LobbyPlayer, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { Color, SeededRng, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  buildAmountResolver,
  buildOnlyFirstSpellTracker,
  parseAddSymbolsFromCost,
  parseMinManaParam,
  parseSubtractSymbolsFromCost,
} from "./cost-mod-helpers.js";

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
const lit = (raw: string): ParamValue => ({ kind: "literal", raw });

const mkCtx = (game: Game) => ({
  game,
  sourceCardId: mkEntityId(1),
  controllerSeat: mkPlayerSeat(0),
  staticId: mkEntityId(2),
});

describe("parseMinManaParam (Wave 11 / Gap 1)", () => {
  it("returns the integer for a literal MinMana$ N", () => {
    expect(parseMinManaParam(lit("1"))).toBe(1);
    expect(parseMinManaParam(lit("0"))).toBe(0);
    expect(parseMinManaParam(lit("3"))).toBe(3);
  });

  it("returns undefined when the param is missing", () => {
    expect(parseMinManaParam(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-numeric literal", () => {
    expect(parseMinManaParam(lit("X"))).toBeUndefined();
    expect(parseMinManaParam(lit("oops"))).toBeUndefined();
  });
});

describe("buildOnlyFirstSpellTracker (Wave 11 / Gap 2)", () => {
  it("returns null when OnlyFirstSpell$ is absent", () => {
    const game = makeGame();
    expect(buildOnlyFirstSpellTracker(undefined, mkCtx(game))).toBeNull();
  });

  it("returns null when OnlyFirstSpell$ is False", () => {
    const game = makeGame();
    expect(buildOnlyFirstSpellTracker(lit("False"), mkCtx(game))).toBeNull();
  });

  it("returns a tracker when OnlyFirstSpell$ True", () => {
    const game = makeGame();
    const tracker = buildOnlyFirstSpellTracker(lit("True"), mkCtx(game));
    expect(tracker).not.toBeNull();
    if (tracker === null) throw new Error("unreachable");

    // Initial state: not fired this turn.
    expect(tracker.alreadyFired(game)).toBe(false);

    // After markUsed, alreadyFired returns true for the same turn.
    tracker.markUsed(game, {});
    expect(tracker.alreadyFired(game)).toBe(true);

    // Advance the turn; the tracker resets implicitly (per-turn key).
    game.turn = 2;
    expect(tracker.alreadyFired(game)).toBe(false);

    // Mark used on turn 2; turn 1 state is independent (we don't test
    // backward — just that current turn flips correctly).
    tracker.markUsed(game, {});
    expect(tracker.alreadyFired(game)).toBe(true);
  });
});

describe("buildAmountResolver (Wave 11 / Gap 6)", () => {
  it("resolves a literal numeric Amount$ to a constant", () => {
    const game = makeGame();
    const resolver = buildAmountResolver(lit("3"), new Map(), mkCtx(game));
    expect(resolver({}, game)).toBe(3);
  });

  it("returns 0 when Amount$ is absent", () => {
    const game = makeGame();
    const resolver = buildAmountResolver(undefined, new Map(), mkCtx(game));
    expect(resolver({}, game)).toBe(0);
  });

  it("resolves an svarRef X to the named SVar's value", () => {
    const game = makeGame();
    const svars = new Map<string, SVarAst>([["X", { kind: "value", raw: "5" }]]);
    const resolver = buildAmountResolver({ kind: "svarRef", name: "X" }, svars, mkCtx(game));
    expect(resolver({}, game)).toBe(5);
  });

  it("falls back to 0 when an SVar reference is unknown (graceful)", () => {
    const game = makeGame();
    const resolver = buildAmountResolver({ kind: "svarRef", name: "Y" }, new Map(), mkCtx(game));
    expect(resolver({}, game)).toBe(0);
  });

  it("resolves an inline Number$N expression", () => {
    const game = makeGame();
    const expr: ParamValue = {
      kind: "expression",
      ast: { kind: "Number", raw: "Number$7", args: [{ kind: "literal", raw: "7" }] },
    };
    const resolver = buildAmountResolver(expr, new Map(), mkCtx(game));
    expect(resolver({}, game)).toBe(7);
  });
});

describe("parseAddSymbolsFromCost / parseSubtractSymbolsFromCost (Wave 11 / Gap 4)", () => {
  it("returns undefined when Cost$ is absent", () => {
    expect(parseAddSymbolsFromCost(undefined)).toBeUndefined();
    expect(parseSubtractSymbolsFromCost(undefined)).toBeUndefined();
  });

  it("parses a single colored pip Cost$ W", () => {
    const out = parseAddSymbolsFromCost(lit("W"));
    expect(out).toBeDefined();
    expect(out).toHaveLength(1);
    expect(out?.[0]).toEqual({ kind: "colored", color: Color.White });
  });

  it("parses a mixed Cost$ '2 R'", () => {
    const out = parseAddSymbolsFromCost(lit("2 R"));
    expect(out).toBeDefined();
    expect(out).toHaveLength(2);
  });
});

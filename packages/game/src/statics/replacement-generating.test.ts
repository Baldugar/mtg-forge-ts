// SPDX-License-Identifier: GPL-3.0-or-later
// Replacement-generating static tests (SP2 Task 28). Exercise the
// bidirectional lifecycle: register a static with N derived replacements,
// verify they land in ReplacementRegistry; unregister → verify they
// drop out. Ensure non-replacement-generating categories don't touch
// the replacement registry.
import type { LobbyPlayer, ReplacementAbility, StaticAbility } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { ReplacementGenPayload } from "./replacement-generating.js";

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

const mkReplacement = (id: number, sourceCardId: number): ReplacementAbility => ({
  id: mkEntityId(id),
  kind: "replacement",
  sourceCardId: mkEntityId(sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches: () => true,
  apply: (intent) => intent,
  isSelfReplacement: false,
  layer: "other",
});

const mkReplacementGenStatic = (opts: {
  id: number;
  sourceCardId: number;
  replacements: readonly ReplacementAbility[];
  category?: "replacementGenerating" | "cantMustMay";
}): StaticAbility => {
  const payload: ReplacementGenPayload = { kind: "replacementGen", replacements: opts.replacements };
  return {
    id: mkEntityId(opts.id),
    kind: "static",
    sourceCardId: mkEntityId(opts.sourceCardId),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: mkPlayerSeat(0),
    category: opts.category ?? "replacementGenerating",
    mode: "CantDraw",
    describe: () => payload,
  };
};

describe("replacement-generating statics (SP2 Task 28)", () => {
  it("register puts one derived replacement into ReplacementRegistry; unregister removes it", () => {
    const game = makeGame();
    const r = mkReplacement(100, 1);
    const s = mkReplacementGenStatic({ id: 5, sourceCardId: 1, replacements: [r] });
    game.staticEffectRegistry.register(s);
    expect(game.replacementRegistry.size()).toBe(1);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.replacementRegistry.size()).toBe(0);
  });

  it("register with 3 derived replacements lands all 3; unregister removes all 3", () => {
    const game = makeGame();
    const rs = [mkReplacement(100, 1), mkReplacement(101, 1), mkReplacement(102, 1)];
    const s = mkReplacementGenStatic({ id: 5, sourceCardId: 1, replacements: rs });
    game.staticEffectRegistry.register(s);
    expect(game.replacementRegistry.size()).toBe(3);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.replacementRegistry.size()).toBe(0);
  });

  it("register/unregister/register cycle works (ledger resets on unregister)", () => {
    const game = makeGame();
    const r1 = mkReplacement(100, 1);
    const s = mkReplacementGenStatic({ id: 5, sourceCardId: 1, replacements: [r1] });
    game.staticEffectRegistry.register(s);
    expect(game.replacementRegistry.size()).toBe(1);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.replacementRegistry.size()).toBe(0);
    // Re-register the same static: previous ledger entry is gone, so
    // the one derived replacement lands again without duplication.
    game.staticEffectRegistry.register(s);
    expect(game.replacementRegistry.size()).toBe(1);
  });

  it("non-replacement-generating static does NOT touch replacement registry", () => {
    const game = makeGame();
    const r = mkReplacement(100, 1);
    // Use category "cantMustMay" — not gated by layer contributors
    // (which demand a continuous-shape payload) nor by the replacement-
    // generating hook. Guarantees the replacement registry stays empty.
    const s = mkReplacementGenStatic({
      id: 5,
      sourceCardId: 1,
      replacements: [r],
      category: "cantMustMay",
    });
    game.staticEffectRegistry.register(s);
    expect(game.replacementRegistry.size()).toBe(0);
  });

  it("multiple replacement-generating statics coexist", () => {
    const game = makeGame();
    const s1 = mkReplacementGenStatic({
      id: 5,
      sourceCardId: 1,
      replacements: [mkReplacement(100, 1)],
    });
    const s2 = mkReplacementGenStatic({
      id: 6,
      sourceCardId: 2,
      replacements: [mkReplacement(200, 2), mkReplacement(201, 2)],
    });
    game.staticEffectRegistry.register(s1);
    game.staticEffectRegistry.register(s2);
    expect(game.replacementRegistry.size()).toBe(3);
    game.staticEffectRegistry.unregister(s1.id);
    expect(game.replacementRegistry.size()).toBe(2);
    game.staticEffectRegistry.unregister(s2.id);
    expect(game.replacementRegistry.size()).toBe(0);
  });

  it("unregistering a static that was never registered is a no-op on replacement registry", () => {
    const game = makeGame();
    game.staticEffectRegistry.unregister(mkEntityId(999));
    expect(game.replacementRegistry.size()).toBe(0);
  });

  it("re-register of the same static id replaces the derived entries without leaking", () => {
    const game = makeGame();
    const s1 = mkReplacementGenStatic({
      id: 5,
      sourceCardId: 1,
      replacements: [mkReplacement(100, 1), mkReplacement(101, 1)],
    });
    const s2 = mkReplacementGenStatic({
      id: 5,
      sourceCardId: 1,
      replacements: [mkReplacement(200, 1)],
    });
    game.staticEffectRegistry.register(s1);
    expect(game.replacementRegistry.size()).toBe(2);
    game.staticEffectRegistry.register(s2);
    // s1's two derived replacements should have been unwound and s2's
    // single derived replacement should be in place.
    expect(game.replacementRegistry.size()).toBe(1);
  });
});

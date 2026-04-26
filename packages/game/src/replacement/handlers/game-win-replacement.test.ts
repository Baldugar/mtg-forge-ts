// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — GameWinReplacement tests. Mirrors GameLossReplacement
// (ValidPlayer$ filtering, Layer$ CantHappen full prevention).
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { GameWinReplacement } from "./game-win-replacement.js";

const SOURCE_ID = mkEntityId(30);
const REPL_ID = mkEntityId(3);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: ALICE,
  replacementId: REPL_ID,
});

/** Platinum Angel: opponents can't win. */
const mkOpponentsCantWinAst = (): ReplacementAst => ({
  eventKind: "GameWin",
  params: {
    ValidPlayer: { kind: "literal", raw: "Opponent" },
    Layer: { kind: "literal", raw: "CantHappen" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkWinIntent = (seat: ReturnType<typeof mkPlayerSeat>): MutationIntent => ({
  kind: "gameWin",
  seat,
  cause: "effect",
});

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(GameWinReplacement);
});

replacementHandlerRegistry.register(GameWinReplacement);

describe("GameWinReplacement (Batch D2)", () => {
  it("is registered under eventKind 'GameWin'", () => {
    expect(replacementHandlerRegistry.has("GameWin")).toBe(true);
  });

  it("matches when an opponent would win (ValidPlayer$ Opponent)", () => {
    const Cls = replacementHandlerRegistry.lookup("GameWin");
    if (!Cls) return;
    const ra = new Cls().build(mkOpponentsCantWinAst(), mkCtx());
    expect(ra.matches(mkWinIntent(BOB))).toBe(true);
  });

  it("does NOT match when the controller would win", () => {
    const Cls = replacementHandlerRegistry.lookup("GameWin");
    if (!Cls) return;
    const ra = new Cls().build(mkOpponentsCantWinAst(), mkCtx());
    expect(ra.matches(mkWinIntent(ALICE))).toBe(false);
  });

  it("apply() returns null (win prevented) on Layer$ CantHappen", () => {
    const Cls = replacementHandlerRegistry.lookup("GameWin");
    if (!Cls) return;
    const ra = new Cls().build(mkOpponentsCantWinAst(), mkCtx());
    expect(ra.apply(mkWinIntent(BOB), {})).toBeNull();
  });

  it("does NOT match a non-gameWin intent", () => {
    const Cls = replacementHandlerRegistry.lookup("GameWin");
    if (!Cls) return;
    const ra = new Cls().build(mkOpponentsCantWinAst(), mkCtx());
    expect(ra.matches({ kind: "damage", amount: 3 })).toBe(false);
  });
});

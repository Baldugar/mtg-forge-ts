// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — GameLossReplacement tests. Verifies ValidPlayer$ filtering
// (You/Opponent/Each/Player), Layer$ CantHappen full prevention, and
// rejection of non-gameLoss intents.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { GameLossReplacement } from "./game-loss-replacement.js";

const SOURCE_ID = mkEntityId(20);
const REPL_ID = mkEntityId(2);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: ALICE,
  replacementId: REPL_ID,
});

/** Platinum Angel — "you can't lose" — Layer$ CantHappen on ValidPlayer$ You. */
const mkCantLoseSelfAst = (): ReplacementAst => ({
  eventKind: "GameLoss",
  params: {
    ValidPlayer: { kind: "literal", raw: "You" },
    Layer: { kind: "literal", raw: "CantHappen" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkCantLoseAnyAst = (): ReplacementAst => ({
  eventKind: "GameLoss",
  params: {
    ValidPlayer: { kind: "literal", raw: "Player" },
    Layer: { kind: "literal", raw: "CantHappen" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkLossIntent = (seat: ReturnType<typeof mkPlayerSeat>): MutationIntent => ({
  kind: "gameLoss",
  seat,
  cause: "life",
});

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(GameLossReplacement);
});

replacementHandlerRegistry.register(GameLossReplacement);

describe("GameLossReplacement (Batch D2)", () => {
  it("is registered under eventKind 'GameLoss'", () => {
    expect(replacementHandlerRegistry.has("GameLoss")).toBe(true);
  });

  describe("ValidPlayer$ You + Layer$ CantHappen (Platinum Angel: 'You can't lose')", () => {
    it("matches when the controller would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      expect(ra.matches(mkLossIntent(ALICE))).toBe(true);
    });

    it("does NOT match when an opponent would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      expect(ra.matches(mkLossIntent(BOB))).toBe(false);
    });

    it("apply() returns null (loss prevented) on Layer$ CantHappen", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      const intent = mkLossIntent(ALICE);
      expect(ra.apply(intent, {})).toBeNull();
    });

    it("layer is 'cantHappen' for Layer$ CantHappen replacements", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      expect(ra.layer).toBe("cantHappen");
    });
  });

  describe("ValidPlayer$ Player (any player can't lose)", () => {
    it("matches any seat", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseAnyAst(), mkCtx());
      expect(ra.matches(mkLossIntent(ALICE))).toBe(true);
      expect(ra.matches(mkLossIntent(BOB))).toBe(true);
    });
  });

  describe("non-gameLoss intent rejection", () => {
    it("does NOT match a non-gameLoss intent", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      const intent: MutationIntent = { kind: "damage", amount: 3 };
      expect(ra.matches(intent)).toBe(false);
    });
  });

  describe("ValidPlayer$ Opponent", () => {
    const mkOppLossAst = (): ReplacementAst => ({
      eventKind: "GameLoss",
      params: {
        ValidPlayer: { kind: "literal", raw: "Opponent" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
    });

    it("matches when an opponent would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkOppLossAst(), mkCtx());
      expect(ra.matches(mkLossIntent(BOB))).toBe(true);
    });

    it("does NOT match when the controller would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkOppLossAst(), mkCtx());
      expect(ra.matches(mkLossIntent(ALICE))).toBe(false);
    });
  });
});

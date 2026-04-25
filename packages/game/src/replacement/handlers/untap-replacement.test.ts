// SPDX-License-Identifier: GPL-3.0-or-later
// UntapReplacement tests — Wave 9.
// Verifies registration, intent matching, and prevent behaviour.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { UntapReplacement } from "./untap-replacement.js";

const SOURCE_ID = mkEntityId(200);
const OTHER_ID = mkEntityId(201);
const REPLACEMENT_ID = mkEntityId(50);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  replacementId: REPLACEMENT_ID,
});

const mkAst = (validCard = "Card.Self", layer?: string, prevent?: string): ReplacementAst => ({
  event: "Untap",
  params: {
    ValidCard: { kind: "literal", raw: validCard },
    ...(layer ? { Layer: { kind: "literal", raw: layer } } : {}),
    ...(prevent ? { Prevent: { kind: "literal", raw: prevent } } : {}),
  },
  effect: { handlerKey: "NoEffect", params: {} },
  isSelf: true,
});

const mkUntapIntent = (cardId: ReturnType<typeof mkEntityId>): MutationIntent =>
  ({ kind: "untap", cardId }) as unknown as MutationIntent;

const mkOtherIntent = (): MutationIntent =>
  ({
    kind: "damage",
    sourceId: SOURCE_ID,
    targetKind: "player",
    targetId: CONTROLLER,
    amount: 1,
    isCombat: false,
  }) as unknown as MutationIntent;

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(UntapReplacement);
});
replacementHandlerRegistry.register(UntapReplacement);

describe("UntapReplacement", () => {
  it("is registered under eventKind 'Untap'", () => {
    expect(replacementHandlerRegistry.has("Untap")).toBe(true);
  });

  describe("matches()", () => {
    it("matches when the source card itself would untap (Card.Self)", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self", "CantHappen"), mkCtx());
      expect(ra.matches(mkUntapIntent(SOURCE_ID))).toBe(true);
    });

    it("does NOT match when a different card would untap (Card.Self)", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self", "CantHappen"), mkCtx());
      expect(ra.matches(mkUntapIntent(OTHER_ID))).toBe(false);
    });

    it("matches any untap intent when ValidCard$ Card", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card", "CantHappen"), mkCtx());
      expect(ra.matches(mkUntapIntent(OTHER_ID))).toBe(true);
    });

    it("does NOT match a non-untap intent", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self", "CantHappen"), mkCtx());
      expect(ra.matches(mkOtherIntent())).toBe(false);
    });
  });

  describe("apply()", () => {
    it("returns null (prevents untap) when Layer$ CantHappen", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self", "CantHappen"), mkCtx());
      const intent = mkUntapIntent(SOURCE_ID);
      expect(ra.apply(intent, {} as never)).toBeNull();
    });

    it("returns null (prevents untap) when Prevent$ True", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self", undefined, "True"), mkCtx());
      const intent = mkUntapIntent(SOURCE_ID);
      expect(ra.apply(intent, {} as never)).toBeNull();
    });

    it("passes intent through when no prevent flag", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self"), mkCtx());
      const intent = mkUntapIntent(SOURCE_ID);
      expect(ra.apply(intent, {} as never)).toBe(intent);
    });
  });

  describe("identity fields", () => {
    it("has correct kind, id, sourceCardId, controllerSeatAtReg", () => {
      const Cls = replacementHandlerRegistry.lookup("Untap");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkAst("Card.Self", "CantHappen"), mkCtx());
      expect(ra.kind).toBe("replacement");
      expect(ra.id).toBe(REPLACEMENT_ID);
      expect(ra.sourceCardId).toBe(SOURCE_ID);
      expect(ra.controllerSeatAtReg).toBe(CONTROLLER);
    });
  });
});
